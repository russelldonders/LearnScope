import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionsTeams from './ConnectionsTeams'
import * as teams from '../lib/managerTeams'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, workspaces: [], refreshWorkspaces: async () => {} }) }))
vi.mock('../lib/skillEvidence', () => ({ uploadEvidenceFiles: vi.fn() }))
vi.mock('../lib/managerTeams', () => ({
  createManagerWorkspace: vi.fn(), createManagerTeam: vi.fn(), listMyLedManagerTeams: vi.fn(),
  listMyManagerTeamRelationships: vi.fn(), listManagerTeamMembers: vi.fn(), listManagerTeamRoster: vi.fn(),
  inviteConnectionToManagerTeam: vi.fn(), inviteConnectionToManagerTeamByEmail: vi.fn(),
  transferManagerTeamLeadership: vi.fn(), listManagerTeamMemberSummaries: vi.fn(),
  listManagerTeamLearningRecords: vi.fn(), listManagerCollaborationRecords: vi.fn(),
  createManagerCollaborationRecord: vi.fn(), createManagerTeamSkillAssessment: vi.fn(),
  setManagerTeamSkillAssessmentEvidence: vi.fn(), listManagerTeamSkillAssessments: vi.fn(),
  getManagerTeamSkillDetail: vi.fn(), setManagerTeamSkillTarget: vi.fn(),
}))
const connections = [{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
function renderTeams(props = {}) {
  return render(<MemoryRouter><ConnectionsTeams connections={connections} currentUserName="Russell" {...props} /></MemoryRouter>)
}
beforeEach(() => {
  vi.resetAllMocks()
  teams.listMyLedManagerTeams.mockResolvedValue([])
  teams.listMyManagerTeamRelationships.mockResolvedValue([])
  teams.listManagerTeamMembers.mockResolvedValue([])
  teams.listManagerTeamRoster.mockResolvedValue([])
  teams.listManagerTeamMemberSummaries.mockResolvedValue([])
  teams.listManagerTeamLearningRecords.mockResolvedValue([])
  teams.listManagerCollaborationRecords.mockResolvedValue([])
  teams.createManagerWorkspace.mockResolvedValue('workspace')
  teams.createManagerTeam.mockResolvedValue('new-team')
  teams.inviteConnectionToManagerTeam.mockResolvedValue('invite')
  teams.transferManagerTeamLeadership.mockResolvedValue()
})
afterEach(cleanup)

// Opens the Members tab's "Invite to team" dialog and picks an existing
// connection -- the flow this merged component now shares with the former
// standalone manager console (ManagerTeamPanel, reused verbatim here).
async function inviteConnection(name) {
  fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Invite to team' }))
  await waitFor(() => expect(screen.getByLabelText('Add a connection')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('Add a connection'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Invite connection' }))
}

describe('Connections teams', () => {
  it('lets a user without a manager workspace create a team and invite a connection', async () => {
    renderTeams()
    await screen.findByText(/No teams yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Form team' }))
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Coaching circle' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create team', exact: true }))
    await screen.findByText('Team created. Invite a connection from the Members tab below.')
    await inviteConnection('alex')
    await waitFor(() => expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('new-team', 'alex'))
    expect(teams.createManagerWorkspace).toHaveBeenCalledOnce()
    expect(teams.createManagerTeam).toHaveBeenCalledWith('workspace', { name: 'Coaching circle' })
  })

  it('auto-selects the only connection and names the team after both people, inviting them immediately', async () => {
    renderTeams({ connections: [{ id: 'alex', name: 'Alex' }] })
    await screen.findByText(/No teams yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Form team' }))
    expect(screen.getByLabelText('Team name')).toHaveValue('Russell and Alex')
    expect(screen.getByRole('checkbox', { name: 'Alex' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Create team', exact: true }))
    await screen.findByText('Team created and members invited.')
    expect(teams.createManagerTeam).toHaveBeenCalledWith('workspace', { name: 'Russell and Alex' })
    expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('new-team', 'alex')
  })

  it('lets you add a member from the picker while creating a team, until you edit the name yourself', async () => {
    renderTeams()
    await screen.findByText(/No teams yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Form team' }))
    expect(screen.getByLabelText('Team name')).toHaveValue('Russell')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam' }))
    expect(screen.getByLabelText('Team name')).toHaveValue('Russell and Sam')
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Custom name' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alex' }))
    expect(screen.getByLabelText('Team name')).toHaveValue('Custom name')
    fireEvent.click(screen.getByRole('button', { name: 'Create team', exact: true }))
    await screen.findByText('Team created and members invited.')
    expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('new-team', 'sam')
    expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('new-team', 'alex')
  })

  it('shows the merged team console (Skills/Members/Learning/Collaboration) for a led team, scoped to the selected team', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }, { id: 'two', name: 'Second team', status: 'active' }])
    renderTeams()
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('one'))
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'Learning' }))
    expect(screen.getByText(/Courses and sessions your team has done together/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Team you lead'), { target: { value: 'two' } })
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    // Switching teams resets back to the Skills tab and drops the stale Learning selection.
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
  })

  it('supports multiple led and joined teams and scopes invitations to the selected team', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }, { id: 'two', name: 'Second team', status: 'active' }])
    teams.listMyManagerTeamRelationships.mockResolvedValue([{ id: 'joined', teamName: 'Book group', managerName: 'Pat', status: 'active' }, { id: 'pending', teamName: 'Study group', managerName: 'Jo', status: 'pending' }])
    renderTeams()
    await screen.findByText('Book group')
    expect(screen.getByText('Study group')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Team you lead'), { target: { value: 'two' } })
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    await inviteConnection('sam')
    await waitFor(() => expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('two', 'sam'))
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
    await screen.findByLabelText('Team you lead')
    await inviteConnection('alex')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send invitation')
    expect(screen.getByLabelText('Add a connection')).toHaveValue('alex')
  })
})
