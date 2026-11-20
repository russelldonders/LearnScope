import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

import {
  DEFAULT_WORKSPACE_SETTINGS,
  __testing,
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
