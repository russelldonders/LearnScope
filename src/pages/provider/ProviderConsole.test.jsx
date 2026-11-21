import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { LanguageProvider } from '../../context/LanguageContext'
import { ProviderCataloguesSection, ProviderTrainingSection } from './ProviderConsole'
import { createProviderCatalogue, deleteProviderCatalogue } from '../../lib/catalogues'
import {
  assignProviderCourseToCatalogue,
  listProviderCatalogues,
  listLinkableCatalogues,
  linkCatalogueToOrganisation,
  unlinkCatalogueFromOrganisation,
} from '../../lib/admin/providerCatalogues'
import {
  listOrganisationCatalogueCourses,
  createProviderCourse,
  listCourseParticipants,
  listCourseVersionHistory,
  createDraftCourseVersion,
  listOrganisationCatalogueApprovers,
  approveCatalogueCourse,
  rejectCatalogueCourse,
  deactivateCatalogueCourse,
  submitCatalogueCourseForApproval,
} from '../../lib/admin/catalogue'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ isPlatformAdmin: false }) }))
vi.mock('../../lib/catalogues', () => ({ createProviderCatalogue: vi.fn(), deleteProviderCatalogue: vi.fn() }))
vi.mock('../../lib/admin/providerCatalogues', () => ({
  assignProviderCourseToCatalogue: vi.fn(), listProviderCatalogues: vi.fn(), listLinkableCatalogues: vi.fn(),
  linkCatalogueToOrganisation: vi.fn(), unlinkCatalogueFromOrganisation: vi.fn(),
}))
vi.mock('../../lib/admin/catalogue', () => ({
  listOrganisationCatalogueCourses: vi.fn(), createProviderCourse: vi.fn(), listCourseParticipants: vi.fn(),
  listCourseVersionHistory: vi.fn(), createDraftCourseVersion: vi.fn(), listOrganisationCatalogueApprovers: vi.fn(),
  approveCatalogueCourse: vi.fn(), rejectCatalogueCourse: vi.fn(), deactivateCatalogueCourse: vi.fn(),
  submitCatalogueCourseForApproval: vi.fn(),
}))
// The bulk dialogs have their own tests; here they only need to show what
// they were given and hand back the callbacks the section passes them.
vi.mock('../../components/BulkPublishCourseDialog', () => ({
  default: ({ courses, excludedCourses, onPublish, onDone }) => (
    <div role="dialog" aria-label="Bulk publish">
      <p>Publishing {courses.map((c) => c.name).join(', ')}; excluded {excludedCourses.map((c) => c.name).join(', ')}</p>
      <button type="button" onClick={async () => { await onPublish(courses[0].id); onDone([courses[0].id], false) }}>Publish now</button>
    </div>
  ),
}))
vi.mock('../../components/BulkAssignToCatalogueDialog', () => ({
  default: ({ items, excludedItems, onAssign, onDone }) => (
    <div role="dialog" aria-label="Bulk push">
      <p>Pushing {items.map((c) => c.name).join(', ')}; excluded {excludedItems.map((c) => c.name).join(', ')}</p>
      <button type="button" onClick={async () => { await onAssign('cat-own', items[0]); onDone([items[0].id], false) }}>Push now</button>
    </div>
  ),
}))
vi.mock('../../components/CourseGeneratorDialog', () => ({
  default: ({ onCreated }) => (
    <div role="dialog" aria-label="Build with AI">
      <button type="button" onClick={() => onCreated('generated-1')}>Generate</button>
    </div>
  ),
}))

const organisation = { id: 'org-1', name: 'Academy' }

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}{location.search}</p>
}

function Training(props) {
  const [searchParams, setSearchParams] = useSearchParams()
  return <ProviderTrainingSection organisation={organisation} userId="me" searchParams={searchParams} setSearchParams={setSearchParams} {...props} />
}

function renderWithRouter(element, path = '/organisation') {
  return render(
    <LanguageProvider>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/organisation" element={element} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
    </LanguageProvider>
  )
}

afterEach(cleanup)

describe('ProviderCataloguesSection', () => {
  const own = { id: 'cat-own-0001', name: 'Safety', description: 'Site safety', learner_visible: true, isOwn: true, courseCount: 2, userCount: 1 }
  const empty = { id: 'cat-empty-0002', name: 'Drafts', description: null, learner_visible: false, isOwn: true, courseCount: 0, userCount: 3 }
  const linked = { id: 'cat-link-0003', linkId: 'link-1', name: 'Partner', isOwn: false, ownerOrganisationName: 'Globex', courseCount: 5, userCount: 0 }

  beforeEach(() => {
    vi.clearAllMocks()
    listProviderCatalogues.mockResolvedValue([own, empty, linked])
    listLinkableCatalogues.mockResolvedValue([{ id: 'cat-other', name: 'Leadership', organisations: { name: 'Initech' } }])
    createProviderCatalogue.mockResolvedValue({})
    linkCatalogueToOrganisation.mockResolvedValue(undefined)
    unlinkCatalogueFromOrganisation.mockResolvedValue(undefined)
    deleteProviderCatalogue.mockResolvedValue(undefined)
  })

  function renderSection(props = {}) {
    return renderWithRouter(<ProviderCataloguesSection organisation={organisation} userId="me" canCreate {...props} />)
  }

  it('lists own and linked catalogues with their visibility, courses and users', async () => {
    renderSection({ detailContext: '&org=academy' })
    const row = (await screen.findByText('Safety')).closest('tr')
    expect(row).toHaveTextContent('Own')
    expect(row).toHaveTextContent('Learner-facing')
    expect(within(row).getByRole('link', { name: '1 user' })).toHaveAttribute('href', '/organisation/catalogues/cat-own-0001?tab=users&org=academy')
    expect(within(row).getByRole('link', { name: 'Open catalogue →' })).toHaveAttribute('href', '/organisation/catalogues/cat-own-0001?org=academy')
    const linkedRow = screen.getByText('Partner').closest('tr')
    expect(linkedRow).toHaveTextContent('Linked · Globex')
    expect(within(linkedRow).queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Drafts').closest('tr')).toHaveTextContent('Backend only')
  })

  it('creates a catalogue and reloads the list', async () => {
    renderSection()
    await screen.findByText('Safety')
    fireEvent.click(screen.getByRole('button', { name: '+ Create catalogue' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New one' } })
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'About it' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Learner-facing/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create catalogue' }))
    await waitFor(() => expect(createProviderCatalogue).toHaveBeenCalledWith('me', 'org-1', { name: 'New one', description: 'About it', learnerVisible: true }))
    await waitFor(() => expect(listProviderCatalogues).toHaveBeenCalledTimes(2))
    expect(screen.queryByLabelText('Name')).toBeNull()
  })

  it('links another provider’s catalogue and unlinks one after confirming', async () => {
    renderSection()
    await screen.findByText('Safety')
    fireEvent.change(screen.getByLabelText('Link a catalogue from another provider'), { target: { value: 'lead' } })
    await waitFor(() => expect(listLinkableCatalogues).toHaveBeenCalledWith('org-1', 'lead'))
    expect(await screen.findByText('Initech')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() => expect(linkCatalogueToOrganisation).toHaveBeenCalledWith('cat-other', 'org-1', 'me'))

    fireEvent.click(within(screen.getByText('Partner').closest('tr')).getByRole('button', { name: 'Unlink' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Unlink "Partner" from Academy? It stays owned by Globex')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    await waitFor(() => expect(unlinkCatalogueFromOrganisation).toHaveBeenCalledWith('link-1'))
  })

  it('warns about live courses before deleting selected catalogues, and keeps failures selected', async () => {
    deleteProviderCatalogue.mockImplementation((id) => (id === 'cat-empty-0002' ? Promise.reject(new Error('in use')) : Promise.resolve()))
    renderSection()
    await screen.findByText('Safety')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Safety' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Drafts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Delete 2 catalogues? 1 of them currently have courses published there (2 courses total)')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('1 of 2 catalogues couldn\'t be deleted: "Drafts" (in use)')
    expect(screen.getByRole('checkbox', { name: 'Select Drafts' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Safety' })).not.toBeChecked()
  })

  it('shows no authoring or selection when read-only', async () => {
    renderSection({ readOnly: true })
    await screen.findByText('Safety')
    expect(screen.queryByRole('button', { name: '+ Create catalogue' })).toBeNull()
    expect(screen.queryByLabelText('Link a catalogue from another provider')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull()
  })
})

describe('ProviderTrainingSection', () => {
  const draft = { id: 'c-draft', name: 'Draft course', course_code: 'DR-1', version_number: 1, status: 'draft', synopsis: 'Early' }
  const pending = { id: 'c-pending', name: 'Pending course', course_code: 'PE-1', version_number: 1, status: 'pending_approval' }
  const approved = { id: 'c-approved', name: 'Approved course', course_code: 'AP-1', version_number: 2, status: 'approved', is_current_published: true }
  const rejected = { id: 'c-rejected', name: 'Rejected course', course_code: null, version_number: 1, status: 'rejected', rejection_reason: 'Too short' }

  beforeEach(() => {
    vi.clearAllMocks()
    listOrganisationCatalogueCourses.mockResolvedValue([draft, pending, approved, rejected])
    listOrganisationCatalogueApprovers.mockResolvedValue([{ user_id: 'someone-else' }])
    createProviderCourse.mockResolvedValue({ id: 'c-new' })
    createDraftCourseVersion.mockResolvedValue('c-approved-v3')
    for (const fn of [approveCatalogueCourse, rejectCatalogueCourse, deactivateCatalogueCourse, submitCatalogueCourseForApproval, assignProviderCourseToCatalogue]) fn.mockResolvedValue(undefined)
    listCourseVersionHistory.mockResolvedValue([
      { id: 'v2', version_number: 2, status: 'approved', approved_at: '2026-10-01T00:00:00Z', creator: { full_name: 'Pat' } },
      { id: 'v1', version_number: 1, status: 'rejected', rejection_reason: null, creator: null },
    ])
    listCourseParticipants.mockResolvedValue([
      { id: 'p1', status: 'started', percent: 40, startedAt: '2026-10-02T00:00:00Z', completed_date: null, profile: { full_name: 'Lee' } },
      { id: 'p2', status: 'enrolled', profile: null },
    ])
  })

  it('lists training with its code, version and status, and filters it', async () => {
    renderWithRouter(<Training />)
    const row = (await screen.findByRole('link', { name: 'Draft course' })).closest('tr')
    expect(row).toHaveTextContent('DR-1')
    expect(screen.getByRole('link', { name: 'Rejected course' }).closest('tr')).toHaveTextContent('Too short')
    expect(screen.getByRole('link', { name: 'Rejected course' }).closest('tr')).toHaveTextContent('Not set')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search training' }), { target: { value: 'AP-1' } })
    expect(screen.queryByRole('link', { name: 'Draft course' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Approved course' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter training by status' }), { target: { value: 'rejected' } })
    expect(screen.getAllByRole('link', { name: /course$/ }).map((l) => l.textContent)).toEqual(['Rejected course'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter training by status' }), { target: { value: 'inactive' } })
    expect(screen.getByText('No training matches these filters.')).toBeInTheDocument()
  })

  it('creates a draft and opens it in the editor', async () => {
    renderWithRouter(<Training detailContext="&org=academy" />)
    await screen.findByRole('link', { name: 'Draft course' })
    fireEvent.click(screen.getByRole('button', { name: '+ Create training' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Brand new' } })
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Synopsis'), { target: { value: 'All about it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(createProviderCourse).toHaveBeenCalledWith('me', 'org-1', {
      name: 'Brand new', provider: '', courseType: '', durationValue: '3', durationUnit: 'hours', synopsis: 'All about it',
    }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/organisation/training/c-new?org=academy')
  })

  it('opens a course built with AI', async () => {
    renderWithRouter(<Training />)
    await screen.findByRole('link', { name: 'Draft course' })
    fireEvent.click(screen.getByRole('button', { name: 'Build with AI' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Build with AI' })).getByRole('button', { name: 'Generate' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/organisation/training/generated-1')
  })

  it('edits a draft in place but confirms before starting a new version of an approved course', async () => {
    renderWithRouter(<Training />)
    const approvedRow = (await screen.findByRole('link', { name: 'Approved course' })).closest('tr')
    fireEvent.click(within(approvedRow).getByRole('button', { name: 'Edit course' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('"Approved course" is approved. Editing it creates a new draft version')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create new version' }))
    await waitFor(() => expect(createDraftCourseVersion).toHaveBeenCalledWith('c-approved'))
    expect(await screen.findByTestId('where')).toHaveTextContent('/organisation/training/c-approved-v3')

    cleanup()
    renderWithRouter(<Training />)
    fireEvent.click(within((await screen.findByRole('link', { name: 'Rejected course' })).closest('tr')).getByRole('button', { name: 'Revise and resubmit' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/organisation/training/c-rejected')
    expect(createDraftCourseVersion).toHaveBeenCalledTimes(1)
  })

  it('lets a catalogue approver approve, reject with a reason and deactivate', async () => {
    listOrganisationCatalogueApprovers.mockResolvedValue([{ user_id: 'me' }])
    renderWithRouter(<Training />)
    const pendingRow = (await screen.findByRole('link', { name: 'Pending course' })).closest('tr')
    fireEvent.click(within(pendingRow).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approveCatalogueCourse).toHaveBeenCalledWith('c-pending'))

    fireEvent.click(within(screen.getByRole('link', { name: 'Draft course' }).closest('tr')).getByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: 'Confirm reject' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Rejection reason (required)'), { target: { value: '  Needs an outline  ' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(rejectCatalogueCourse).toHaveBeenCalledWith('c-draft', 'Needs an outline'))

    fireEvent.click(within(screen.getByRole('link', { name: 'Approved course' }).closest('tr')).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(deactivateCatalogueCourse).toHaveBeenCalledWith('c-approved'))
    fireEvent.click(within(screen.getByRole('link', { name: 'Rejected course' }).closest('tr')).getByRole('button', { name: 'Reactivate (approve)' }))
    await waitFor(() => expect(approveCatalogueCourse).toHaveBeenCalledWith('c-rejected'))
  })

  it('shows no moderation to someone who is not an approver', async () => {
    renderWithRouter(<Training />)
    await screen.findByRole('link', { name: 'Pending course' })
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
  })

  it('shows a course’s version history and participants', async () => {
    renderWithRouter(<Training canViewParticipants />)
    const row = (await screen.findByRole('link', { name: 'Approved course' })).closest('tr')
    fireEvent.click(within(row).getByRole('button', { name: 'Version history' }))
    const history = await screen.findByRole('dialog', { name: 'Approved course version history' })
    expect(await within(history).findByText('Version 2')).toBeInTheDocument()
    expect(history).toHaveTextContent('Pat')
    expect(history).toHaveTextContent('Rejected: No reason was given.')
    fireEvent.click(within(history).getByRole('button', { name: 'Close' }))

    fireEvent.click(within(row).getByRole('button', { name: 'View participants' }))
    const participants = await screen.findByRole('dialog', { name: 'Approved course participants' })
    expect(await within(participants).findByText('Lee')).toBeInTheDocument()
    expect(participants).toHaveTextContent('40% complete')
    expect(participants).toHaveTextContent('Unnamed participant')
  })

  it('publishes or pushes only the eligible training in a selection', async () => {
    renderWithRouter(<Training />)
    await screen.findByRole('link', { name: 'Draft course' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Draft course' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Approved course' }))

    fireEvent.click(screen.getByRole('button', { name: 'Publish (1)' }))
    const publish = screen.getByRole('dialog', { name: 'Bulk publish' })
    expect(publish).toHaveTextContent('Publishing Draft course; excluded Approved course')
    fireEvent.click(within(publish).getByRole('button', { name: 'Publish now' }))
    await waitFor(() => expect(submitCatalogueCourseForApproval).toHaveBeenCalledWith('c-draft', []))
    await waitFor(() => expect(listOrganisationCatalogueCourses).toHaveBeenCalledTimes(2))
  })

  it('pushes approved, published training to a catalogue', async () => {
    renderWithRouter(<Training />)
    await screen.findByRole('link', { name: 'Draft course' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Draft course' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Approved course' }))
    fireEvent.click(screen.getByRole('button', { name: 'Push to catalogue (1)' }))
    const push = screen.getByRole('dialog', { name: 'Bulk push' })
    expect(push).toHaveTextContent('Pushing Approved course; excluded Draft course')
    fireEvent.click(within(push).getByRole('button', { name: 'Push now' }))
    await waitFor(() => expect(assignProviderCourseToCatalogue).toHaveBeenCalledWith('cat-own', 'c-approved'))
  })

  it('shows training without authoring, selection or moderation when read-only', async () => {
    listOrganisationCatalogueApprovers.mockResolvedValue([{ user_id: 'me' }])
    renderWithRouter(<Training readOnly />)
    const row = (await screen.findByRole('link', { name: 'Draft course' })).closest('tr')
    expect(screen.queryByRole('button', { name: '+ Create training' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(within(row).getByRole('link', { name: 'View course' })).toHaveAttribute('href', '/organisation/training/c-draft')
  })
})
