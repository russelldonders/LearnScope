import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrainingTeamAccessDialog from './TrainingTeamAccessDialog'
import { inviteOrganisationStaff, removeOrganisationMember } from '../../lib/admin/organisations'

vi.mock('../../lib/admin/organisations', () => ({
  inviteOrganisationStaff: vi.fn(),
  removeOrganisationMember: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())
const learner = { user_id: 'learner', email: 'learner@example.com', employerMember: true, role: 'member', status: 'active' }
const staff = { user_id: 'staff', email: 'staff@example.com', trainingAccess: { id: 'staff-row', role: 'trainer', status: 'active' } }
function show(members) {
  const onUpdated = vi.fn().mockResolvedValue()
  render(<TrainingTeamAccessDialog organisation={{ id: 'org-1', name: 'Acme' }} members={members} onClose={vi.fn()} onUpdated={onUpdated} />)
  return onUpdated
}

describe('Training team access selection action', () => {
  it('requests the chosen role only for selected users without access', async () => {
    inviteOrganisationStaff.mockResolvedValue({ alreadyExisted: true })
    const refresh = show([learner, staff])
    fireEvent.change(screen.getByLabelText('Training access role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign access role' }))
    await screen.findByText(/Training access requested for 1 user/)
    expect(inviteOrganisationStaff).toHaveBeenCalledExactlyOnceWith('org-1', learner.email, 'admin')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('protects automatic employer admin access', () => {
    show([{ ...learner, role: 'admin', trainingAccess: { id: 'admin-row', role: 'admin', status: 'active' } }])
    expect(screen.getByText(/automatic employer admin access/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove training access/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign access role' })).not.toBeInTheDocument()
  })

  it('removes the selected staff membership and refreshes the roster', async () => {
    removeOrganisationMember.mockResolvedValue()
    const refresh = show([staff])
    fireEvent.click(screen.getByRole('button', { name: /Remove training access/ }))
    await screen.findByText(`Training access removed for ${staff.email}.`)
    expect(removeOrganisationMember).toHaveBeenCalledExactlyOnceWith('staff-row')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('retries failed users without sending successful requests twice', async () => {
    inviteOrganisationStaff.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Request failed')).mockResolvedValueOnce({})
    show([learner, { ...learner, user_id: 'second', email: 'second@example.com' }])
    fireEvent.click(screen.getByRole('button', { name: 'Assign access role' }))
    await screen.findByText('second@example.com: Request failed')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Assign access role' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Assign access role' }))
    await waitFor(() => expect(inviteOrganisationStaff).toHaveBeenCalledTimes(3))
    expect(inviteOrganisationStaff).toHaveBeenLastCalledWith('org-1', 'second@example.com', 'trainer')
  })
})
