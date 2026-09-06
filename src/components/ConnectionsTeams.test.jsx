import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionsTeams from './ConnectionsTeams'
import * as teams from '../lib/managerTeams'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, workspaces: [], refreshWorkspaces: async () => {} }) }))
vi.mock('../lib/managerTeams', () => ({
  createManagerWorkspace: vi.fn(), createManagerTeam: vi.fn(), listMyLedManagerTeams: vi.fn(),
  listMyManagerTeamRelationships: vi.fn(), listManagerTeamMembers: vi.fn(), listManagerTeamRoster: vi.fn(),
  inviteConnectionToManagerTeam: vi.fn(), transferManagerTeamLeadership: vi.fn(),
}))
const connections = [{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
function renderTeams() { return render(<MemoryRouter><ConnectionsTeams connections={connections} /></MemoryRouter>) }
beforeEach(() => {
  vi.resetAllMocks()
  teams.listMyLedManagerTeams.mockResolvedValue([])
  teams.listMyManagerTeamRelationships.mockResolvedValue([])
  teams.listManagerTeamMembers.mockResolvedValue([])
  teams.listManagerTeamRoster.mockResolvedValue([])
  teams.createManagerWorkspace.mockResolvedValue('workspace')
  teams.createManagerTeam.mockResolvedValue('new-team')
  teams.inviteConnectionToManagerTeam.mockResolvedValue('invite')
  teams.transferManagerTeamLeadership.mockResolvedValue()
})
afterEach(cleanup)

describe('Connections teams', () => {
  it('lets a user without a manager workspace create a team and invite a connection', async () => {
    renderTeams()
    await screen.findByText(/No teams yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Create a team' }))
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Coaching circle' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create team', exact: true }))
    await screen.findByText('Team created. Choose a connection to invite below.')
    await waitFor(() => expect(screen.getByLabelText('Connection to invite')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('Connection to invite'), { target: { value: 'alex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    await screen.findByText(/Invitation sent to Alex/)
    expect(teams.createManagerWorkspace).toHaveBeenCalledOnce()
    expect(teams.createManagerTeam).toHaveBeenCalledWith('workspace', { name: 'Coaching circle' })
    expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('new-team', 'alex')
    expect(screen.getByRole('option', { name: 'Alex — Invited' })).toBeDisabled()
  })

  it('supports multiple led and joined teams and scopes invitations to the selected team', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }, { id: 'two', name: 'Second team', status: 'active' }])
    teams.listMyManagerTeamRelationships.mockResolvedValue([{ id: 'joined', teamName: 'Book group', managerName: 'Pat', status: 'active' }, { id: 'pending', teamName: 'Study group', managerName: 'Jo', status: 'pending' }])
    renderTeams()
    await screen.findByText('Book group')
    expect(screen.getByText('Study group')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Team you lead'), { target: { value: 'two' } })
    await waitFor(() => expect(screen.getByLabelText('Connection to invite')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('Connection to invite'), { target: { value: 'sam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    await screen.findByText(/Invitation sent to Sam/)
    expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('two', 'sam')
    expect(screen.getByRole('link', { name: 'Manage skills' })).toHaveAttribute('href', '/manager?section=skills&team=two')
  })

  it('transfers leadership only to a selected active member and removes leader controls', async () => {
    teams.listMyLedManagerTeams.mockResolvedValueOnce([{ id: 'one', name: 'First team', status: 'active' }]).mockResolvedValue([])
    teams.listManagerTeamRoster.mockResolvedValue([{ id: 'membership-alex', name: 'Alex', role: 'member' }, { id: 'membership-me', name: 'Me', role: 'manager' }])
    renderTeams()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change team leader' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Change team leader' }))
    expect(screen.queryByRole('option', { name: 'Me' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('New team leader'), { target: { value: 'membership-alex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transfer leadership' }))
    await screen.findByText('Team leader changed. You are now a member of this team.')
    expect(teams.transferManagerTeamLeadership).toHaveBeenCalledWith('one', 'membership-alex')
    expect(screen.queryByRole('button', { name: 'Change team leader' })).not.toBeInTheDocument()
  })

  it('keeps selection and displays failed invitations for retry', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }])
    teams.inviteConnectionToManagerTeam.mockRejectedValue(new Error('Could not send invitation'))
    renderTeams()
    await waitFor(() => expect(screen.getByLabelText('Connection to invite')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('Connection to invite'), { target: { value: 'alex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Invite to team' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send invitation')
    expect(screen.getByLabelText('Connection to invite')).toHaveValue('alex')
  })
})
