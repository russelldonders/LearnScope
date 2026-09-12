import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { EmployerLearnersPanel } from './EmployerConsole'
import {
  listEmployerMembers,
  listEmployerDataAccessRequests,
  requestEmployerDataAccess,
  removeEmployerMember,
  listFieldDefinitionsForEmployer,
  listEmployerMemberFieldValues,
} from '../../lib/admin/employers'

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

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

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
  return <EmployerLearnersPanel employer={{ id: 'employer', name: 'Acme' }} searchParams={searchParams} setSearchParams={setSearchParams} />
}
beforeEach(() => {
  vi.clearAllMocks()
  listEmployerMembers.mockResolvedValue(members)
  listEmployerDataAccessRequests.mockResolvedValue([])
  requestEmployerDataAccess.mockResolvedValue({ learner_id: 'a', status: 'pending' })
  removeEmployerMember.mockResolvedValue(undefined)
  listFieldDefinitionsForEmployer.mockResolvedValue(fieldDefinitions)
  listEmployerMemberFieldValues.mockResolvedValue([])
})
afterEach(cleanup)
it('reveals invitations through Add users and uses the account code', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  expect(await screen.findByText('USR-000001')).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Email' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Add users' }))
  expect(await screen.findByRole('textbox', { name: 'Email' })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Add users' })).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: '← Back to users' }))
  expect(screen.getByRole('table')).toBeVisible()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select a@example.com' }))
  expect(screen.queryByRole('link', { name: 'Add users' })).toBeNull()
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
