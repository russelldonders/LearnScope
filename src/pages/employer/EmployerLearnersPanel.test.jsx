import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { EmployerLearnersPanel } from './EmployerConsole'
import { listEmployerMembers, listEmployerDataAccessRequests, requestEmployerDataAccess, removeEmployerMember } from '../../lib/admin/employers'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

vi.mock('../../lib/admin/employers', async (original) => ({
  ...await original(),
  listEmployerMembers: vi.fn(), listEmployerDataAccessRequests: vi.fn(),
  requestEmployerDataAccess: vi.fn(), removeEmployerMember: vi.fn(),
}))
const members = [
  { id: 'membership-a', user_id: 'a', userCode: 'USR-000001', email: 'a@example.com', status: 'active', role: 'member' },
  { id: 'membership-b', user_id: 'b', userCode: 'USR-000002', email: 'b@example.com', status: 'pending', role: 'member' },
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
})
afterEach(cleanup)
it('reveals invitations through Add users and uses the account code', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  expect(await screen.findByText('USR-000001')).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Add or invite by email' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add users' }))
  expect(screen.getByRole('textbox', { name: 'Add or invite by email' })).toBeVisible()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select a@example.com' }))
  expect(screen.queryByRole('button', { name: 'Close add users' })).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Add or invite by email' })).toBeNull()
})
it('requests access for eligible selections and removes active and pending users after confirmation', async () => {
  render(<MemoryRouter><Panel /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select a@example.com' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select b@example.com' }))
  fireEvent.click(screen.getByRole('button', { name: 'Request data access' }))
  await waitFor(() => expect(requestEmployerDataAccess).toHaveBeenCalledWith('employer', 'a'))
  expect(requestEmployerDataAccess).toHaveBeenCalledTimes(1)
  await screen.findByText(/1 data access request\(s\) sent/)
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(removeEmployerMember).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(removeEmployerMember).toHaveBeenCalledTimes(2))
  expect(removeEmployerMember).toHaveBeenCalledWith('membership-a')
  expect(removeEmployerMember).toHaveBeenCalledWith('membership-b')
})
