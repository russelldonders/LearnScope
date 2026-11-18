import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatFullDate } from '../lib/dates'

const lib = vi.hoisted(() => ({
  listMyResources: vi.fn(),
  listSharedResources: vi.fn(),
  addResource: vi.fn(),
  updateResource: vi.fn(),
  deleteResource: vi.fn(),
  getResourceFileUrl: vi.fn(),
  hideSharedResource: vi.fn(),
  unhideSharedResource: vi.fn(),
  reportSharedResource: vi.fn(),
  createSkillPackageLaunchSession: vi.fn(),
  listMyPackageSessions: vi.fn(),
  listMyPackageStatements: vi.fn(),
}))
const content = vi.hoisted(() => ({ fetchShimmedLaunchDoc: vi.fn() }))
const connections = vi.hoisted(() => ({ listConnections: vi.fn() }))

vi.mock('../lib/skillResources', async (importOriginal) => ({ ...(await importOriginal()), ...lib }))
vi.mock('../lib/connections', () => connections)
vi.mock('../lib/courseContent', async (importOriginal) => ({ ...(await importOriginal()), ...content }))
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
const librarySkill = { id: 'skill-1', user_id: 'me', library_skill_id: 'lib-1' }
const customSkill = { id: 'skill-2', library_skill_id: null }

beforeEach(() => {
  lib.listMyResources.mockResolvedValue([])
  lib.listSharedResources.mockResolvedValue([])
  lib.listMyPackageSessions.mockResolvedValue({})
  lib.listMyPackageStatements.mockResolvedValue([])
  lib.addResource.mockResolvedValue('new-id')
  lib.updateResource.mockResolvedValue()
  lib.deleteResource.mockResolvedValue()
  lib.hideSharedResource.mockResolvedValue()
  lib.unhideSharedResource.mockResolvedValue()
  lib.reportSharedResource.mockResolvedValue()
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

  it('takes http or https from the address typed, or from the choice beside it', async () => {
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }))
    const address = screen.getByRole('textbox', { name: 'Link' })
    const protocol = screen.getByRole('combobox', { name: 'Web address type' })
    expect(protocol).toHaveValue('https://')

    fireEvent.change(address, { target: { value: 'HTTP://intranet.example.com/wiki' } })
    expect(protocol).toHaveValue('http://')
    expect(address).toHaveValue('intranet.example.com/wiki')

    fireEvent.change(protocol, { target: { value: 'https://' } })
    fireEvent.change(address, { target: { value: 'example.com/guide' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Guide' } })
    fireEvent.submit(address.closest('form'))
    await waitFor(() => expect(lib.addResource).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/guide' })))
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

  it('lets a viewer hide a shared resource, with undo', async () => {
    lib.listSharedResources.mockResolvedValue([
      { id: 's1', kind: 'link', title: 'Spammy', url: 'https://example.com/s', sharer_name: 'Pat', created_at: '2026-11-10' },
    ])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(lib.hideSharedResource).toHaveBeenCalledWith('me', 's1'))
    expect(await screen.findByRole('status')).toHaveTextContent('“Spammy” is hidden from your list.')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(lib.unhideSharedResource).toHaveBeenCalledWith('me', 's1'))
  })

  it('asks for a reason before reporting a shared resource', async () => {
    lib.listSharedResources.mockResolvedValue([
      { id: 's1', kind: 'link', title: 'Spammy', url: 'https://example.com/s', sharer_name: 'Pat', created_at: '2026-11-10' },
    ])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Report' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a reason.')
    fireEvent.click(screen.getByRole('radio', { name: 'Spam or advertising' }))
    fireEvent.change(screen.getByLabelText(/Anything else moderators/), { target: { value: 'An advert' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() => expect(lib.reportSharedResource).toHaveBeenCalledWith('s1', 'spam', 'An advert'))
    expect(await screen.findByRole('status')).toHaveTextContent('has been reported and hidden')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('tells the owner a resource was removed from sharing, with no way to share it again', async () => {
    lib.listMyResources.mockResolvedValue([
      { id: 'r1', kind: 'link', title: 'Pulled', url: 'https://example.com', audience: 'private', recipientIds: [], moderation_removed_at: '2026-11-15T10:00:00Z' },
    ])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    expect(await screen.findByText(/Removed from sharing by LearnScope moderators/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByRole('group', { name: 'Who can see it?' })).not.toBeInTheDocument()
    expect(screen.getByText(/can only be kept for yourself/)).toBeInTheDocument()
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

  it('adds a SCORM package, which can be shared with everyone tracking the skill', async () => {
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }))
    fireEvent.click(screen.getByRole('radio', { name: 'SCORM' }))
    expect(audienceOptions().some((text) => text.includes('Everyone tracking'))).toBe(true)
    const zip = new File(['zip'], 'Safety basics.zip', { type: 'application/zip' })
    const input = screen.getByLabelText('Package (.zip)')
    expect(input).toHaveAttribute('accept', '.zip,application/zip')
    fireEvent.change(input, { target: { files: [zip] } })
    expect(screen.getByLabelText('Title')).toHaveValue('Safety basics')
    fireEvent.click(screen.getByRole('radio', { name: /Everyone tracking/ }))
    fireEvent.submit(input.closest('form'))
    await waitFor(() => expect(lib.addResource).toHaveBeenCalled())
    expect(lib.addResource.mock.calls[0][0]).toMatchObject({ kind: 'scorm', file: zip, audience: 'skill_public' })
  })

  it('opens a SCORM package over the page, and closes it again', async () => {
    content.fetchShimmedLaunchDoc.mockResolvedValue('<p>Lesson</p>')
    lib.listMyResources.mockResolvedValue([{
      id: 'p1', kind: 'scorm', title: 'Safety basics', file_name: 'safety.zip', audience: 'private', recipientIds: [],
      package_path: 'learners/me/p1', launch_path: 'index.html', created_at: '2026-11-18T09:00:00Z',
    }])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Safety basics' }))
    const dialog = screen.getByRole('dialog', { name: 'Safety basics' })
    const frame = await within(dialog).findByTitle('Safety basics')
    expect(content.fetchShimmedLaunchDoc).toHaveBeenCalledWith('/course-content/learners/me/p1/index.html')
    expect(frame).toHaveAttribute('srcdoc', '<p>Lesson</p>')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('launches a shared xAPI package with its own session, recording to the viewer', async () => {
    lib.createSkillPackageLaunchSession.mockResolvedValue({ id: 'session-1', token: 'tok', registration: 'reg-1' })
    lib.listSharedResources.mockResolvedValue([{
      id: 'x1', kind: 'xapi', title: 'Fire drill', file_name: 'drill.zip', audience: 'connections', sharer_name: 'Sam',
      package_path: 'learners/sam/x1', launch_path: 'story.html', created_at: '2026-11-18T09:00:00Z',
    }])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Fire drill' }))
    const frame = await within(screen.getByRole('dialog')).findByTitle('Fire drill')
    // Opened from the learner's own skill, so the session is an activity there.
    expect(lib.createSkillPackageLaunchSession).toHaveBeenCalledWith('x1', 'me', 'skill-1')
    const src = new URL(frame.getAttribute('src'), 'http://localhost')
    expect(src.pathname).toBe('/course-content/learners/sam/x1/story.html')
    expect(src.searchParams.get('registration')).toBe('reg-1')
    // The package learns the launch, not who the learner is.
    expect(JSON.parse(src.searchParams.get('actor')).account.name).toBe('reg-1')
  })

  it('shows a package moderators removed as no longer openable', async () => {
    lib.listMyResources.mockResolvedValue([{
      id: 'p2', kind: 'scorm', title: 'Gone course', file_name: 'gone.zip', audience: 'private', recipientIds: [],
      package_path: 'learners/me/p2', launch_path: 'index.html', moderation_removed_at: '2026-11-18T10:00:00Z',
      created_at: '2026-11-18T09:00:00Z',
    }])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    expect(await screen.findByText('Gone course')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gone course' })).not.toBeInTheDocument()
    expect(screen.getByText(/its package files were deleted/)).toBeInTheDocument()
  })

  it('shows the learner\'s own activity on an xAPI package, and what it recorded when opened up', async () => {
    lib.listSharedResources.mockResolvedValue([{
      id: 'x1', kind: 'xapi', title: 'Fire drill', file_name: 'drill.zip', audience: 'connections', sharer_name: 'Sam',
      package_path: 'learners/sam/x1', launch_path: 'story.html', created_at: '2026-11-18T09:00:00Z',
    }])
    lib.listMyPackageSessions.mockResolvedValue({
      x1: [
        { id: 's2', openedAt: '2026-11-18T14:00:00Z', minutes: 12, outcome: 'passed', earned: ['Gold stamp'] },
        { id: 's1', openedAt: '2026-11-17T09:00:00Z', minutes: 5, outcome: null, earned: ['Bronze stamp', 'Gold stamp'] },
      ],
    })
    lib.listMyPackageStatements.mockResolvedValue([
      { id: 'st1', recorded_at: '2026-11-18T14:05:00Z', statement: { verb: { id: 'https://openbadgespec.org/xapi/verbs/earned', display: { 'en-US': 'earned' } }, object: { definition: { name: { 'en-US': 'Gold stamp' } } } } },
    ])
    render(<SkillResourcesSection skill={librarySkill} user={user} />)
    const activity = await screen.findByText(/Opened 2 times/)
    expect(activity).toHaveTextContent(`Opened 2 times · last ${formatFullDate('2026-11-18T14:00:00Z')} · Passed · 2 earned`)
    expect(screen.getByText('Bronze stamp')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show your activity' }))
    expect(screen.getByText(`${formatFullDate('2026-11-18T14:00:00Z')} · 12 min · Passed · 1 earned`)).toBeInTheDocument()
    expect(await screen.findByText(/^earned$/)).toBeInTheDocument()
    expect(lib.listMyPackageStatements).toHaveBeenCalledWith('me', 'x1')
  })

  it('refreshes the package\'s activity, and tells the skill, when it\'s closed', async () => {
    const onActivityChange = vi.fn()
    content.fetchShimmedLaunchDoc.mockResolvedValue('<p>Lesson</p>')
    lib.listMyResources.mockResolvedValue([{
      id: 'p1', kind: 'scorm', title: 'Safety basics', file_name: 'safety.zip', audience: 'private', recipientIds: [],
      package_path: 'learners/me/p1', launch_path: 'index.html', created_at: '2026-11-18T09:00:00Z',
    }])
    render(<SkillResourcesSection skill={librarySkill} user={user} onActivityChange={onActivityChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Safety basics' }))
    const dialog = screen.getByRole('dialog', { name: 'Safety basics' })
    await within(dialog).findByTitle('Safety basics')
    const loadsBefore = lib.listMyPackageSessions.mock.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onActivityChange).toHaveBeenCalled()
    await waitFor(() => expect(lib.listMyPackageSessions.mock.calls.length).toBeGreaterThan(loadsBefore))
  })
})
