import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lib = vi.hoisted(() => ({
  listMyResources: vi.fn(),
  listSharedResources: vi.fn(),
  addResource: vi.fn(),
  updateResource: vi.fn(),
  deleteResource: vi.fn(),
  getResourceFileUrl: vi.fn(),
}))
const connections = vi.hoisted(() => ({ listConnections: vi.fn() }))

vi.mock('../lib/skillResources', async (importOriginal) => ({ ...(await importOriginal()), ...lib }))
vi.mock('../lib/connections', () => connections)
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillResourcesSection } = await import('./SkillResourcesSection')

const user = { id: 'me' }
const librarySkill = { id: 'skill-1', library_skill_id: 'lib-1' }
const customSkill = { id: 'skill-2', library_skill_id: null }

beforeEach(() => {
  lib.listMyResources.mockResolvedValue([])
  lib.listSharedResources.mockResolvedValue([])
  lib.addResource.mockResolvedValue('new-id')
  lib.updateResource.mockResolvedValue()
  lib.deleteResource.mockResolvedValue()
  connections.listConnections.mockResolvedValue([{ id: 'sam', name: 'Sam' }, { id: 'alex', name: 'Alex' }])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function audienceOptions() {
  const group = screen.getByRole('group', { name: 'Who can see it?' })
  return within(group).getAllByRole('radio').map((radio) => radio.closest('label').textContent)
}

describe('SkillResourcesSection', () => {
  it('lists the learner\'s resources with who sees them, and what others shared', async () => {
    lib.listMyResources.mockResolvedValue([
      { id: 'r1', kind: 'link', title: 'Style guide', url: 'https://example.com/guide', note: 'Chapter 3', audience: 'skill_public', recipientIds: [] },
      { id: 'r2', kind: 'file', title: 'My notes', file_path: 'me/skill-1/a.pdf', file_name: 'notes.pdf', audience: 'selected', recipientIds: ['sam'] },
    ])
    lib.listSharedResources.mockResolvedValue([
      { id: 's1', kind: 'video', title: 'Walkthrough', url: 'https://example.com/v', sharer_name: 'Pat', created_at: '2026-11-10T10:00:00Z' },
    ])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    expect(await screen.findByRole('link', { name: 'Style guide' })).toHaveAttribute('href', 'https://example.com/guide')
    expect(screen.getByRole('link', { name: 'Style guide' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Shared with everyone tracking this skill')).toBeInTheDocument()
    expect(await screen.findByText('Shared with Sam')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My notes' })).toBeInTheDocument()
    expect(screen.getByText('Shared with you')).toBeInTheDocument()
    expect(screen.getByText(/^Shared by Pat/)).toBeInTheDocument()
    expect(lib.listSharedResources).toHaveBeenCalledWith('skill-1')
  })

  it('adds a link shared with chosen contacts', async () => {
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Docs' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Link' }), { target: { value: 'https://example.com/docs' } })
    fireEvent.click(screen.getByRole('radio', { name: /Selected contacts/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Alex' }))
    fireEvent.click(within(screen.getByRole('button', { name: 'Cancel' }).parentElement).getByRole('button', { name: 'Add resource' }))
    await waitFor(() => expect(lib.addResource).toHaveBeenCalled())
    expect(lib.addResource.mock.calls[0][0]).toMatchObject({
      userId: 'me', skillId: 'skill-1', kind: 'link', title: 'Docs', url: 'https://example.com/docs', audience: 'selected', recipientIds: ['alex'],
    })
  })

  it('checks the link and the chosen contacts before saving', async () => {
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }))
    const form = screen.getByLabelText('Title').closest('form')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Docs' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Link' }), { target: { value: 'javascript:alert(1)' } })
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('http:// or https://')
    fireEvent.change(screen.getByRole('textbox', { name: 'Link' }), { target: { value: 'https://example.com' } })
    fireEvent.click(screen.getByRole('radio', { name: /Selected contacts/ }))
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one contact')
    expect(lib.addResource).not.toHaveBeenCalled()
  })

  it('never offers public sharing for an uploaded document, or on a skill no one else tracks', async () => {
    const { unmount } = render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }))
    expect(audienceOptions().some((text) => text.includes('Everyone tracking'))).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /Everyone tracking/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Document' }))
    expect(audienceOptions().some((text) => text.includes('Everyone tracking'))).toBe(false)
    // Switched back to private rather than left on an option that's gone.
    expect(screen.getByRole('radio', { name: /Only me/ })).toBeChecked()
    unmount()
    lib.listSharedResources.mockClear()

    render(<SkillResourcesSection skill={customSkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }))
    expect(audienceOptions().some((text) => text.includes('Everyone tracking'))).toBe(false)
    expect(lib.listSharedResources).not.toHaveBeenCalled()
  })

  it('can align a resource to a knowledge and an application level, both optional', async () => {
    lib.listMyResources.mockResolvedValue([
      { id: 'r1', kind: 'link', title: 'Primer', url: 'https://example.com', audience: 'private', recipientIds: [], knowledge_level: 2, practical_level: null },
    ])
    lib.listSharedResources.mockResolvedValue([
      { id: 's1', kind: 'link', title: 'Deep dive', url: 'https://example.com/d', sharer_name: 'Pat', created_at: '2026-11-10T10:00:00Z', knowledge_level: 5, practical_level: 4 },
    ])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    expect(await screen.findByText('Knowledge: Aware')).toBeInTheDocument()
    expect(screen.getByText('Knowledge: Deep understanding')).toBeInTheDocument()
    expect(screen.getByText('Application: Skilled')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add resource' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Basics' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Link' }), { target: { value: 'https://example.com/b' } })
    fireEvent.change(screen.getByLabelText('Knowledge level (optional)'), { target: { value: '3' } })
    fireEvent.submit(screen.getByLabelText('Title').closest('form'))
    await waitFor(() => expect(lib.addResource).toHaveBeenCalled())
    expect(lib.addResource.mock.calls[0][0]).toMatchObject({ knowledgeLevel: 3, practicalLevel: null })

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Knowledge level (optional)')).toHaveValue('2')
    expect(screen.getByLabelText('Application level (optional)')).toHaveValue('')
  })

  it('suggests resources for the learner\'s level, sorts by fit, and filters by level', async () => {
    lib.listMyResources.mockResolvedValue([
      { id: 'r1', kind: 'link', title: 'Old basics', url: 'https://example.com/1', audience: 'private', recipientIds: [], knowledge_level: 1, created_at: '2026-11-12' },
      { id: 'r2', kind: 'link', title: 'Unlevelled', url: 'https://example.com/2', audience: 'private', recipientIds: [], created_at: '2026-11-13' },
      { id: 'r3', kind: 'link', title: 'At my level', url: 'https://example.com/3', audience: 'private', recipientIds: [], knowledge_level: 3, created_at: '2026-11-01' },
    ])
    lib.listSharedResources.mockResolvedValue([
      { id: 's1', kind: 'link', title: 'Stretch', url: 'https://example.com/s', sharer_name: 'Pat', created_at: '2026-11-10', knowledge_level: 4 },
    ])
    const { container } = render(<SkillResourcesSection skill={librarySkill} user={user} knowledgeLevel={3} />)
    const suggestions = await waitFor(() => {
      const box = container.querySelector('[data-suggestions]')
      expect(box).not.toBeNull()
      return box
    })
    // The next step first, then the current level; not the far or unlevelled.
    expect(within(suggestions).getAllByRole('link').map((a) => a.textContent)).toEqual(['Stretch', 'At my level'])
    expect(within(suggestions).getByText('Next step')).toBeInTheDocument()
    expect(within(suggestions).getByText(/Pat/)).toBeInTheDocument()

    const ownTitles = () => [...container.querySelectorAll('ul.mt-3 > li')].map((li) => li.querySelector('a, button').textContent)
    // Sorted by fit by default once the learner has a level.
    expect(ownTitles()).toEqual(['At my level', 'Old basics', 'Unlevelled'])
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'newest' } })
    // Newest keeps the order they were loaded in (newest first from the database).
    expect(ownTitles()).toEqual(['Old basics', 'Unlevelled', 'At my level'])

    fireEvent.change(screen.getByLabelText('Knowledge'), { target: { value: '1' } })
    expect(ownTitles()).toEqual(['Old basics'])
    expect(container.querySelector('[data-suggestions]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Knowledge'), { target: { value: '5' } })
    expect(screen.getByText('No resources at these levels.')).toBeInTheDocument()
  })

  it('offers no sort by fit before the learner has a level', async () => {
    lib.listMyResources.mockResolvedValue([
      { id: 'r1', kind: 'link', title: 'Levelled', url: 'https://example.com/1', audience: 'private', recipientIds: [], knowledge_level: 2 },
    ])
    const { container } = render(<SkillResourcesSection skill={librarySkill} user={user} />)
    expect(await screen.findByLabelText('Knowledge')).toBeInTheDocument()
    expect(screen.queryByLabelText('Sort')).not.toBeInTheDocument()
    expect(container.querySelector('[data-suggestions]')).toBeNull()
  })

  it('asks before deleting', async () => {
    const resource = { id: 'r1', kind: 'link', title: 'Style guide', url: 'https://example.com', audience: 'private', recipientIds: [] }
    lib.listMyResources.mockResolvedValue([resource])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(lib.deleteResource).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(lib.deleteResource).toHaveBeenCalledWith(resource))
  })
})
