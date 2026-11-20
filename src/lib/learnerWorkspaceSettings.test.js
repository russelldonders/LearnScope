import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

import {
  DEFAULT_WORKSPACE_SETTINGS,
  __testing,
  addCustomPage,
  removeCustomPage,
  sectionLabel,
  isSectionVisible,
  normaliseWorkspaceSettings,
  validateWorkspaceSettings,
  visibleSections,
} from './learnerWorkspaceSettings'

describe('normaliseWorkspaceSettings', () => {
  it('uses the defaults when the organisation has saved nothing', () => {
    expect(normaliseWorkspaceSettings(null)).toEqual(DEFAULT_WORKSPACE_SETTINGS)
  })

  it('keeps every section exactly once, in the saved order', () => {
    const settings = normaliseWorkspaceSettings({ section_order: ['role', 'role', 'learning', 'bogus'] })
    expect(settings.sectionOrder).toEqual(['role', 'learning', 'home', 'catalogue'])
  })

  it('never hides Home and never lands on a hidden section', () => {
    const settings = normaliseWorkspaceSettings({ hidden_sections: ['home', 'catalogue'], landing_section: 'catalogue' })
    expect(settings.hiddenSections).toEqual(['catalogue'])
    expect(settings.landingSection).toBe('home')
    expect(isSectionVisible(settings, 'home')).toBe(true)
    expect(isSectionVisible(settings, 'catalogue')).toBe(false)
    expect(isSectionVisible(settings, 'admin')).toBe(false)
    expect(visibleSections(settings)).toEqual(['home', 'learning', 'role'])
  })

  it('drops links that are not https and blank section names', () => {
    const settings = normaliseWorkspaceSettings({
      pinned_links: [
        { label: 'Handbook', url: 'https://example.com/handbook' },
        { label: 'Bad', url: 'javascript:alert(1)' },
        { label: 'Old', url: 'http://example.com' },
      ],
      section_labels: { learning: 'My development', role: '  ', admin: 'Admin' },
    })
    expect(settings.pinnedLinks).toEqual([{ label: 'Handbook', url: 'https://example.com/handbook' }])
    expect(settings.sectionLabels).toEqual({ learning: 'My development' })
  })

  it('falls back to the defaults for unknown behaviour values', () => {
    const settings = normaliseWorkspaceSettings({ catalogue_enrolment: 'approval', assigned_training_framing: 'mandatory' })
    expect(settings.catalogueEnrolment).toBe('self_enrol')
    expect(settings.assignedTrainingFraming).toBe('assigned')
  })
})

describe('validateWorkspaceSettings', () => {
  it('accepts the defaults', () => {
    expect(validateWorkspaceSettings({ ...DEFAULT_WORKSPACE_SETTINGS })).toEqual([])
  })

  it('explains each problem the database would refuse', () => {
    const errors = validateWorkspaceSettings({
      ...DEFAULT_WORKSPACE_SETTINGS,
      sectionLabels: { role: 'x'.repeat(31) },
      contactEmail: 'not-an-email',
      pinnedLinks: [{ label: '', url: 'http://example.com' }],
    })
    expect(errors).toEqual([
      'The name for “role” must be 30 characters or fewer.',
      'Enter a valid contact email address.',
      'Link 1 needs a name.',
      'Link 1 needs a full web address starting with https://',
    ])
  })
})

describe('saving', () => {
  it('trims text, stores blanks as empty and never lands on a hidden section', () => {
    const row = __testing.toRow({
      ...DEFAULT_WORKSPACE_SETTINGS,
      hiddenSections: ['learning'],
      landingSection: 'learning',
      sectionLabels: { catalogue: '  Courses  ', role: ' ' },
      welcomeMessage: '  Hello  ',
      contactEmail: '   ',
      pinnedLinks: [{ label: ' Handbook ', url: ' https://example.com ' }],
    })
    expect(row.landing_section).toBe('home')
    expect(row.section_labels).toEqual({ catalogue: 'Courses' })
    expect(row.welcome_message).toBe('Hello')
    expect(row.contact_email).toBeNull()
    expect(row.pinned_links).toEqual([{ label: 'Handbook', url: 'https://example.com' }])
  })
})

describe('custom sections', () => {
  const pageId = 'page-11111111-1111-4111-8111-111111111111'

  it('reads the organisation’s own pages into the order, hidden list and landing section', () => {
    const settings = normaliseWorkspaceSettings({
      custom_pages: [
        { id: pageId, title: 'Benefits', body: 'Pension details' },
        { id: 'not-a-page', title: 'Bad', body: '' },
        { id: 'page-22222222-2222-4222-8222-222222222222', title: '  ', body: '' },
      ],
      section_order: ['home', pageId, 'not-a-page', 'learning', 'catalogue', 'role'],
      hidden_sections: [pageId],
      landing_section: pageId,
    })
    expect(settings.customPages).toEqual([{ id: pageId, title: 'Benefits', body: 'Pension details' }])
    expect(settings.sectionOrder).toEqual(['home', pageId, 'learning', 'catalogue', 'role'])
    expect(settings.hiddenSections).toEqual([pageId])
    expect(settings.landingSection).toBe('home')
    expect(isSectionVisible(settings, pageId)).toBe(false)
  })

  it('adds a page that is new, empty and last, and removes it from everywhere', () => {
    const added = addCustomPage({ ...DEFAULT_WORKSPACE_SETTINGS })
    const page = added.customPages[0]
    expect(page).toEqual({ id: expect.stringMatching(/^page-[0-9a-f-]{36}$/), title: 'New section', body: '' })
    expect(added.sectionOrder.at(-1)).toBe(page.id)
    expect(isSectionVisible(added, page.id)).toBe(true)
    expect(sectionLabel((key) => key, added, page.id)).toBe('New section')

    const removed = removeCustomPage({ ...added, hiddenSections: [page.id], landingSection: page.id }, page.id)
    expect(removed.customPages).toEqual([])
    expect(removed.sectionOrder).toEqual(DEFAULT_WORKSPACE_SETTINGS.sectionOrder)
    expect(removed.hiddenSections).toEqual([])
    expect(removed.landingSection).toBe('home')
  })

  it('asks for a name and limits content length', () => {
    const errors = validateWorkspaceSettings({
      ...DEFAULT_WORKSPACE_SETTINGS,
      customPages: [{ id: pageId, title: ' ', body: '' }, { id: 'page-22222222-2222-4222-8222-222222222222', title: 'Policies', body: 'x'.repeat(10001) }],
    })
    expect(errors).toEqual([
      'Your section 1 needs a name.',
      'The content of “Policies” must be 10000 characters or fewer.',
    ])
  })
})
