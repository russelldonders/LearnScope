import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { EmployerLearnersPanel, EmployerUsersPanel } from './EmployerConsole'
import {
  listEmployerMembers,
  listEmployerDataAccessRequests,
  requestEmployerDataAccess,
  removeEmployerMember,
  listFieldDefinitionsForEmployer,
  listEmployerMemberFieldValues,
} from '../../lib/admin/employers'
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
  supabase: { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }) },
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
