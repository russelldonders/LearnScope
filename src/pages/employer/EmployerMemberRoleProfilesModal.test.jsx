import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmployerMemberRoleProfilesModal from './EmployerMemberRoleProfilesModal'
import {
  listEmployerRoleProfiles,
  listRoleAssignmentsForMember,
  assignEmployerRoleProfile,
  disconnectEmployerRoleAssignment,
  withdrawEmployerRoleAssignment,
  setEmployerRoleAssignmentDates,
} from '../../lib/employerRoleProfiles'

vi.mock('../../lib/employerRoleProfiles', () => ({
  listEmployerRoleProfiles: vi.fn(),
  listRoleAssignmentsForMember: vi.fn(),
  assignEmployerRoleProfile: vi.fn(),
  disconnectEmployerRoleAssignment: vi.fn(),
  withdrawEmployerRoleAssignment: vi.fn(),
  setEmployerRoleAssignmentDates: vi.fn(),
}))

const employer = { id: 'employer-1', name: 'Leeds United' }
const member = { id: 'member-1', email: 'jane@example.com' }
const profiles = [
  { id: 'profile-1', name: 'Senior Groundskeeper' },
  { id: 'profile-2', name: 'Kit Manager' },
]

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  listEmployerRoleProfiles.mockResolvedValue(profiles)
  assignEmployerRoleProfile.mockResolvedValue(undefined)
  disconnectEmployerRoleAssignment.mockResolvedValue(undefined)
  withdrawEmployerRoleAssignment.mockResolvedValue(undefined)
  setEmployerRoleAssignmentDates.mockResolvedValue(undefined)
})

describe('EmployerMemberRoleProfilesModal', () => {
  it('lists active assignments and offers only not-yet-assigned profiles to add', async () => {
    listRoleAssignmentsForMember.mockResolvedValue([
      { id: 'assignment-1', roleProfileId: 'profile-1', roleProfileName: 'Senior Groundskeeper', status: 'linked', startDate: null, endDate: null },
    ])
    render(<EmployerMemberRoleProfilesModal employer={employer} member={member} onClose={() => {}} />)
    expect(await screen.findByText('Senior Groundskeeper')).toBeInTheDocument()
    expect(screen.getByText('Linked')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Senior Groundskeeper' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Kit Manager' })).toBeInTheDocument()
  })

  it('shows an empty state with no active assignments', async () => {
    listRoleAssignmentsForMember.mockResolvedValue([])
    render(<EmployerMemberRoleProfilesModal employer={employer} member={member} onClose={() => {}} />)
    expect(await screen.findByText('No role profiles assigned yet.')).toBeInTheDocument()
  })

  it('adds a role profile via assignEmployerRoleProfile', async () => {
    listRoleAssignmentsForMember.mockResolvedValue([])
    render(<EmployerMemberRoleProfilesModal employer={employer} member={member} onClose={() => {}} />)
    await screen.findByText('No role profiles assigned yet.')
    fireEvent.change(screen.getByLabelText('Add a role profile'), { target: { value: 'profile-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(assignEmployerRoleProfile).toHaveBeenCalledWith('profile-1', 'member-1'))
  })

  it('withdraws a still-proposed assignment, disconnects a linked one', async () => {
    listRoleAssignmentsForMember.mockResolvedValue([
      { id: 'assignment-1', roleProfileId: 'profile-1', roleProfileName: 'Senior Groundskeeper', status: 'proposed', startDate: null, endDate: null },
      { id: 'assignment-2', roleProfileId: 'profile-2', roleProfileName: 'Kit Manager', status: 'linked', startDate: null, endDate: null },
    ])
    render(<EmployerMemberRoleProfilesModal employer={employer} member={member} onClose={() => {}} />)
    const removeButtons = await screen.findAllByRole('button', { name: 'Remove' })
    fireEvent.click(removeButtons[0])
    await waitFor(() => expect(withdrawEmployerRoleAssignment).toHaveBeenCalledWith('assignment-1'))
    fireEvent.click(removeButtons[1])
    await waitFor(() => expect(disconnectEmployerRoleAssignment).toHaveBeenCalledWith('assignment-2'))
  })

  it('sets start/end dates on an assignment', async () => {
    listRoleAssignmentsForMember.mockResolvedValue([
      { id: 'assignment-1', roleProfileId: 'profile-1', roleProfileName: 'Senior Groundskeeper', status: 'linked', startDate: null, endDate: null },
    ])
    render(<EmployerMemberRoleProfilesModal employer={employer} member={member} onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Set start/end date'))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(setEmployerRoleAssignmentDates).toHaveBeenCalledWith('assignment-1', '2026-09-01', '2026-12-01'))
  })
})
