import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { EmployerUsersPanel } from './EmployerConsole'
import { EmployerLearnersPanel } from './EmployerLearnersPanel'
import {
  listEmployerMembers,
  listEmployerDataAccessRequests,
  requestEmployerDataAccess,
  removeEmployerMember,
  listFieldDefinitionsForEmployer,
  listEmployerMemberFieldValues,
  addEmployerMember,
  upsertEmployerMemberFieldValue,
  listEmployerCatalogueCourses,
  assignCourseToEmployerMembers,
  listEmployerCourseAssignments,
  suggestSkillToEmployerMembers,
  listEmployerSkillSuggestions,
} from '../../lib/admin/employers'
import { listEmployerRoleProfiles, assignEmployerRoleProfile } from '../../lib/employerRoleProfiles'
import { listLibrarySkills } from '../../lib/skillLibrary'
import { listEmployerManagementRelationships } from '../../lib/employerManagement'
import { LanguageProvider } from '../../context/LanguageContext'

// EmployerLearnersPanel reads isPlatformAdmin and user (the latter only for
// the roster-field save's updated_by, not exercised here) -- stub the
// context like Connections.test.jsx does rather than rendering a real
// AuthProvider, since this test doesn't exercise auth itself. false mirrors
// this test's non-admin scenario, so the table renders exactly as it always
// has here.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ isPlatformAdmin: false, user: { id: 'admin' } }),
}))

vi.mock('../../lib/skillLibrary', () => ({ listLibrarySkills: vi.fn().mockResolvedValue([]) }))

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
  },
}))

vi.mock('../../lib/employerManagement', () => ({
  createEmployerManagementRelationship: vi.fn(),
  endEmployerManagementRelationship: vi.fn(),
  listEmployerManagementRelationships: vi.fn(),
  updateEmployerManagementRelationship: vi.fn(),
}))

vi.mock('../../lib/admin/employers', async (original) => ({
  ...await original(),
  listEmployerMembers: vi.fn(), listEmployerDataAccessRequests: vi.fn(),
  requestEmployerDataAccess: vi.fn(), removeEmployerMember: vi.fn(),
  listFieldDefinitionsForEmployer: vi.fn(), listEmployerMemberFieldValues: vi.fn(),
  addEmployerMember: vi.fn(), upsertEmployerMemberFieldValue: vi.fn(),
  listEmployerCatalogueCourses: vi.fn(), assignCourseToEmployerMembers: vi.fn(),
  listEmployerCourseAssignments: vi.fn(), suggestSkillToEmployerMembers: vi.fn(),
  listEmployerSkillSuggestions: vi.fn(),
}))

vi.mock('../../lib/employerRoleProfiles', async (original) => ({
  ...await original(),
  listEmployerRoleProfiles: vi.fn(), assignEmployerRoleProfile: vi.fn(),
}))
const members = [
  { id: 'membership-a', user_id: 'a', userCode: 'USR-000001', email: 'a@example.com', status: 'active', role: 'member' },
  { id: 'membership-b', user_id: 'b', userCode: 'USR-000002', email: 'b@example.com', status: 'pending', role: 'member' },
]
// Add users now renders one input per roster field definition (the email
// address is just this field, not a separate hardcoded input) -- a single
// unrequired field keeps this fixture's accessible name plain ("Email"
// rather than "Email *") since these tests aren't exercising validation.
const fieldDefinitions = [
  { id: 'field-email', key: 'email', label: 'Email', field_type: 'email', required: false, options: null },
]
function Panel() {
  const [searchParams, setSearchParams] = useSearchParams()
  return <LanguageProvider><EmployerLearnersPanel employer={{ id: 'employer', name: 'Acme' }} searchParams={searchParams} setSearchParams={setSearchParams} /></LanguageProvider>
}
function StaffWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams()
  return <LanguageProvider><EmployerUsersPanel employer={{ id: 'employer', name: 'Acme' }} searchParams={searchParams} setSearchParams={setSearchParams} /></LanguageProvider>
}
beforeEach(() => {
  vi.clearAllMocks()
  listEmployerMembers.mockResolvedValue(members)
  listEmployerDataAccessRequests.mockResolvedValue([])
  requestEmployerDataAccess.mockResolvedValue({ learner_id: 'a', status: 'pending' })
  removeEmployerMember.mockResolvedValue(undefined)
  listFieldDefinitionsForEmployer.mockResolvedValue(fieldDefinitions)
  listEmployerMemberFieldValues.mockResolvedValue([])
  listEmployerManagementRelationships.mockResolvedValue([])
  addEmployerMember.mockResolvedValue({ alreadyExisted: false })
  upsertEmployerMemberFieldValue.mockResolvedValue(undefined)
  listEmployerCatalogueCourses.mockResolvedValue([{ id: 'course-1', name: 'Fire safety' }])
  assignCourseToEmployerMembers.mockResolvedValue([{ assigned_to: 'a' }])
  listEmployerCourseAssignments.mockResolvedValue([
    { id: 'asg-1', assigned_to: 'a', status: 'enrolled', created_at: '2026-10-01T00:00:00Z', course_catalogue: { name: 'First aid' } },
    { id: 'asg-2', assigned_to: 'z', status: 'assigned', created_at: '2026-10-02T00:00:00Z', course_catalogue: { name: 'Not selected' } },
  ])
  listLibrarySkills.mockResolvedValue([{ id: 'skill-1', name: 'Python', category: 'Software' }])
  suggestSkillToEmployerMembers.mockResolvedValue([{ learner_id: 'a' }])
  listEmployerSkillSuggestions.mockResolvedValue([
    { id: 'sug-1', learner_id: 'a', skill_name: 'SQL', status: 'adopted', created_at: '2026-10-01T00:00:00Z' },
  ])
  listEmployerRoleProfiles.mockResolvedValue([
    { id: 'role-1', name: 'Analyst', status: 'active' },
    { id: 'role-2', name: 'Old role', status: 'archived' },
  ])
  assignEmployerRoleProfile.mockResolvedValue(undefined)
})
afterEach(cleanup)
it('reveals invitations through Add staff and uses the account code', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  expect(await screen.findByText('USR-000001')).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Add staff' }))
  expect(await screen.findByRole('textbox', { name: 'Email' })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Add staff' })).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: '← Back to people' }))
  expect(screen.getByRole('table')).toBeVisible()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select a@example.com' }))
  expect(screen.queryByRole('link', { name: 'Add staff' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
})
it('requests access for eligible selections and removes active and pending users after confirmation', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select a@example.com' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select b@example.com' }))
  fireEvent.click(screen.getByRole('button', { name: 'Request data access' }))
  fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
  await waitFor(() => expect(requestEmployerDataAccess).toHaveBeenCalledWith('employer', 'a', { categories: ['skills'], skillIds: [], comment: '' }))
  expect(requestEmployerDataAccess).toHaveBeenCalledTimes(1)
  await screen.findByText(/1 data access request\(s\) sent/)
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(removeEmployerMember).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(removeEmployerMember).toHaveBeenCalledTimes(2))
  expect(removeEmployerMember).toHaveBeenCalledWith('membership-a')
  expect(removeEmployerMember).toHaveBeenCalledWith('membership-b')
})

it('opens Reporting & management from the Staff workspace without carrying roster filters', async () => {
  render(<MemoryRouter initialEntries={['/?q=member&page=2']}><StaffWorkspace /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'People' })).toBeVisible()

  fireEvent.click(screen.getByRole('link', { name: 'Reporting & management' }))

  expect(await screen.findByRole('heading', { name: 'Reporting & management' })).toBeVisible()
  expect(screen.getByRole('searchbox', { name: 'Search reporting relationships' })).toHaveValue('')
  expect(listEmployerManagementRelationships).toHaveBeenCalledWith('employer')
})

it('filters the roster by email search and resets the filter', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  await screen.findByText('USR-000001')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search staff' }), { target: { value: 'b@' } })
  expect(screen.queryByText('USR-000001')).toBeNull()
  expect(screen.getByText('USR-000002')).toBeVisible()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search staff' }), { target: { value: 'nobody' } })
  expect(screen.getByText('No users match your search.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
  expect(await screen.findByText('USR-000001')).toBeVisible()
  expect(screen.getByText('USR-000002')).toBeVisible()
})

it('adds a staff member from the roster fields and returns to the list', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  await screen.findByText('USR-000001')
  fireEvent.click(screen.getByRole('link', { name: 'Add staff' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: ' new@example.com ' } })
  const addForm = screen.getByRole('button', { name: 'Save' }).closest('form')
  fireEvent.change(within(addForm).getByRole('combobox', { name: 'Role' }), { target: { value: 'admin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(addEmployerMember).toHaveBeenCalledWith('employer', 'new@example.com', 'admin', { 'field-email': 'new@example.com' }))
  expect(await screen.findByText("new@example.com invited. They'll get access once they accept the invite email.")).toBeVisible()
  expect(await screen.findByRole('table')).toBeVisible()
  expect(listEmployerMembers).toHaveBeenCalledTimes(2)
})

it('views a member and saves their roster details', async () => {
  listEmployerMemberFieldValues.mockResolvedValue([{ employer_member_id: 'membership-a', field_definition_id: 'field-email', value: 'a@example.com' }])
  render(<MemoryRouter><Panel /></MemoryRouter>)
  await screen.findByText('USR-000001')
  fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0])
  const detail = screen.getByRole('dialog')
  expect(within(detail).getByRole('heading', { name: 'Member details' })).toBeVisible()
  expect(within(detail).getByText('No request yet')).toBeVisible()
  fireEvent.click(within(detail).getByRole('button', { name: 'Edit details' }))
  const edit = screen.getByRole('dialog')
  expect(within(edit).getByRole('textbox', { name: 'Email' })).toHaveValue('a@example.com')
  fireEvent.change(within(edit).getByRole('textbox', { name: 'Email' }), { target: { value: 'renamed@example.com' } })
  fireEvent.click(within(edit).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(upsertEmployerMemberFieldValue).toHaveBeenCalledWith('membership-a', 'field-email', 'renamed@example.com', 'admin'))
})

it('assigns training to the active members of a selection and shows their history', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select a@example.com' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select b@example.com' }))
  fireEvent.click(screen.getByRole('button', { name: 'Assign training' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(/1 of the selected user is not an active employer member/)).toBeVisible()
  expect(await within(dialog).findByText('First aid')).toBeVisible()
  expect(within(dialog).queryByText('Not selected')).toBeNull()
  expect(within(dialog).getByText('Started')).toBeVisible()
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Course' }), { target: { value: 'course-1' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to 1' }))
  await waitFor(() => expect(assignCourseToEmployerMembers).toHaveBeenCalledWith('employer', 'course-1', ['a']))
  expect(await screen.findByText('1 learner(s) assigned this course.')).toBeVisible()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Select a@example.com' })).not.toBeChecked()
})

it('suggests a library skill with a target and reports learners skipped by the server', async () => {
  listEmployerMembers.mockResolvedValue([...members, { id: 'membership-c', user_id: 'c', userCode: 'USR-000003', email: 'c@example.com', status: 'active', role: 'member' }])
  render(<MemoryRouter><Panel /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select a@example.com' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select c@example.com' }))
  fireEvent.click(screen.getByRole('button', { name: 'Assign skill' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('SQL')).toBeVisible()
  expect(within(dialog).getByText('Added by learner')).toBeVisible()
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Skill' }), { target: { value: 'pyt' } })
  fireEvent.click(within(dialog).getByRole('button', { name: /Python/ }))
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Target level (optional)' }), { target: { value: '3' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to 2' }))
  expect(await within(dialog).findByText('A target date is required when a target level is set.')).toBeVisible()
  expect(suggestSkillToEmployerMembers).not.toHaveBeenCalled()
  fireEvent.change(within(dialog).getByLabelText('Target date'), { target: { value: '2027-01-31' } })
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Why this matters (optional)' }), { target: { value: '  For the new project  ' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to 2' }))
  await waitFor(() => expect(suggestSkillToEmployerMembers).toHaveBeenCalledWith('employer', 'skill-1', 'Python', ['a', 'c'], { targetLevel: 3, targetDate: '2027-01-31', comments: 'For the new project' }))
  expect(await screen.findByText('1 learner(s) assigned this skill.')).toBeVisible()
  expect(screen.getByText(/already had a live suggestion for this skill/)).toHaveTextContent('c@example.com')
})

it('proposes an active role profile to the selected members', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select a@example.com' }))
  fireEvent.click(screen.getByRole('button', { name: 'Assign role profile' }))
  const dialog = screen.getByRole('dialog')
  const select = await within(dialog).findByRole('combobox', { name: 'Role profile' })
  expect(within(select).queryByRole('option', { name: 'Old role' })).toBeNull()
  fireEvent.change(select, { target: { value: 'role-1' } })
  fireEvent.change(within(dialog).getByLabelText('Start date (optional)'), { target: { value: '2026-12-01' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Propose to 1' }))
  await waitFor(() => expect(assignEmployerRoleProfile).toHaveBeenCalledWith('role-1', 'membership-a', '2026-12-01', null))
  expect(await screen.findByText('1 learner(s) proposed this role profile.')).toBeVisible()
})
