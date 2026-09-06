import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionsTeams from './ConnectionsTeams'
import * as teams from '../lib/managerTeams'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, workspaces: [], refreshWorkspaces: async () => {} }) }))
vi.mock('../lib/skillEvidence', () => ({ uploadEvidenceFiles: vi.fn() }))
vi.mock('../lib/managerTeams', () => ({
  createManagerWorkspace: vi.fn(), createManagerTeam: vi.fn(), listMyLedManagerTeams: vi.fn(),
  listMyArchivedManagerTeams: vi.fn(), listMyManagerTeamRelationships: vi.fn(), listMyManagerShareableSkills: vi.fn(),
  listManagerTeamMembers: vi.fn(), listManagerTeamRoster: vi.fn(),
  inviteConnectionToManagerTeam: vi.fn(), inviteConnectionToManagerTeamByEmail: vi.fn(),
  transferManagerTeamLeadership: vi.fn(), listManagerTeamMemberSummaries: vi.fn(),
  listManagerTeamLearningRecords: vi.fn(), listManagerCollaborationRecords: vi.fn(),
  createManagerCollaborationRecord: vi.fn(), createManagerTeamSkillAssessment: vi.fn(),
  setManagerTeamSkillAssessmentEvidence: vi.fn(), listManagerTeamSkillAssessments: vi.fn(),
  getManagerTeamSkillDetail: vi.fn(), setManagerTeamSkillTarget: vi.fn(),
  archiveManagerTeam: vi.fn(), restoreManagerTeam: vi.fn(),
  setManagerTeamSharedSkills: vi.fn(), leaveManagerTeam: vi.fn(),
}))
const connections = [{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
function renderTeams(props = {}) {
  return render(<MemoryRouter><ConnectionsTeams connections={connections} currentUserName="Russell" {...props} /></MemoryRouter>)
}
beforeEach(() => {
  vi.resetAllMocks()
  teams.listMyLedManagerTeams.mockResolvedValue([])
  teams.listMyArchivedManagerTeams.mockResolvedValue([])
  teams.listMyManagerTeamRelationships.mockResolvedValue([])
  teams.listMyManagerShareableSkills.mockResolvedValue([])
  teams.listManagerTeamMembers.mockResolvedValue([])
  teams.listManagerTeamRoster.mockResolvedValue([])
  teams.listManagerTeamMemberSummaries.mockResolvedValue([])
  teams.listManagerTeamLearningRecords.mockResolvedValue([])
  teams.listManagerCollaborationRecords.mockResolvedValue([])
  teams.listManagerTeamSkillAssessments.mockResolvedValue([])
  teams.createManagerWorkspace.mockResolvedValue('workspace')
  teams.createManagerTeam.mockResolvedValue('new-team')
  teams.inviteConnectionToManagerTeam.mockResolvedValue('invite')
  teams.transferManagerTeamLeadership.mockResolvedValue()
  teams.archiveManagerTeam.mockResolvedValue()
  teams.restoreManagerTeam.mockResolvedValue()
  teams.setManagerTeamSharedSkills.mockResolvedValue()
  teams.leaveManagerTeam.mockResolvedValue()
})
afterEach(async () => {
  // Some flows (retry-triggered reloads after archive/restore/transfer) kick
  // off a promise chain the test doesn't explicitly await to completion --
  // flush it here so it can't resolve mid-flight into the next test and
  // consume a mockResolvedValueOnce meant for that test instead.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  cleanup()
})

// Opens the Members tab's "Invite to team" dialog and picks an existing
// connection -- the flow this merged component now shares with the former
// standalone manager console (ManagerTeamPanel, reused verbatim here).
async function inviteConnection(name) {
  fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
  // A team switch (including the one right after creating it) resets the
  // active panel back to Skills, which can otherwise race a click that
  // follows immediately -- wait for Members to actually land as selected.
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 })
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
    // A single team skips the selector entirely and shows it as a heading.
    expect(screen.getByRole('heading', { name: 'Coaching circle' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument()
    await inviteConnection('alex')
    await waitFor(() => expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('new-team', 'alex'))
    expect(teams.createManagerWorkspace).toHaveBeenCalledOnce()
    expect(teams.createManagerTeam).toHaveBeenCalledWith('workspace', { name: 'Coaching circle' })
    // Let the reload the invite triggers fully settle before the test ends,
    // so its promises can't resolve mid-flight into the next test.
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('new-team'))
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

    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'lead:two' } })
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    // Switching teams resets back to the Skills tab and drops the stale Learning selection.
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
  })

  it('supports multiple led and joined teams in one selector, keeping pending invitations separate', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }, { id: 'two', name: 'Second team', status: 'active' }])
    teams.listMyManagerTeamRelationships.mockResolvedValue([
      { id: 'joined', teamId: 'book-team', teamName: 'Book group', managerName: 'Pat', status: 'active', teamStatus: 'active', sharedSkillIds: [] },
      { id: 'pending', teamId: 'study-team', teamName: 'Study group', managerName: 'Jo', status: 'pending', teamStatus: 'active', sharedSkillIds: [] },
    ])
    renderTeams()
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('one'))
    // The unified selector lists all three teams the user leads or has joined...
    const select = screen.getByLabelText('Team')
    expect(screen.getByText(/Book group/)).toBeInTheDocument()
    // ...while a merely-pending invitation stays in its own separate list, not selectable.
    expect(screen.getByText('Study group')).toBeInTheDocument()
    expect(screen.getByText('Respond to invitation')).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'lead:two' } })
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    const summariesCallsBeforeInvite = teams.listManagerTeamMemberSummaries.mock.calls.length
    await inviteConnection('sam')
    await waitFor(() => expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('two', 'sam'))
    // Let the invite's own reload fully settle before the test ends, so its
    // promises can't resolve mid-flight into the next test.
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries.mock.calls.length).toBeGreaterThan(summariesCallsBeforeInvite))
  })

  it("renders a joined team's member view (share skills, roster, leave team) instead of the leader console", async () => {
    teams.listMyManagerTeamRelationships.mockResolvedValue([
      { id: 'membership-1', teamId: 'book-team', teamName: 'Book group', managerName: 'Pat', status: 'active', teamStatus: 'active', sharedSkillIds: [] },
    ])
    teams.listMyManagerShareableSkills.mockResolvedValue([{ id: 'skill-1', name: 'Welding', level: 3, evidenceCount: 0 }])
    teams.listManagerTeamRoster.mockResolvedValue([{ id: 'r1', name: 'Pat', avatarUrl: null, role: 'manager', memberSince: '2026-01-01' }])
    renderTeams()
    // Only one team overall, so it renders as a heading, not a dropdown.
    expect(await screen.findByRole('heading', { name: 'Book group' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Skills' })).not.toBeInTheDocument()
    // The member-detail fetch (roster) resolves independently of the heading,
    // so wait for the panel's own controls rather than racing it.
    fireEvent.click(await screen.findByRole('button', { name: 'Choose skills to share' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Welding/ }))
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(teams.setManagerTeamSharedSkills).toHaveBeenCalledWith('membership-1', ['skill-1']))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Leave team' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave team' }))
    await waitFor(() => expect(teams.leaveManagerTeam).toHaveBeenCalledWith('membership-1'))
  })

  it('lets a leader archive an active team and restore an archived one, freezing new actions in between', async () => {
    teams.listMyLedManagerTeams.mockResolvedValueOnce([{ id: 'one', name: 'First team', status: 'active' }]).mockResolvedValue([])
    teams.listMyArchivedManagerTeams.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'one', name: 'First team', status: 'archived' }])
    renderTeams()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Archive team' })).not.toBeDisabled())
    // Still fully interactive while active.
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 })
    expect(await screen.findByRole('button', { name: 'Invite to team' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Archive team' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive team' }))
    await waitFor(() => expect(teams.archiveManagerTeam).toHaveBeenCalledWith('one'))
    await screen.findByText(/Team archived/)

    // Once archived: no invite/change-leader controls, but still viewable, with a restore option.
    expect(await screen.findByText(/This team has been archived/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite to team' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change team leader' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore team' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Restore team' }))
    await waitFor(() => expect(teams.restoreManagerTeam).toHaveBeenCalledWith('one'))
    // Let the reload restoring triggers fully settle before the test ends,
    // so its promises can't resolve mid-flight into the next test -- this is
    // the *third* load (initial, then one after archiving, then this one).
    await waitFor(() => expect(teams.listMyLedManagerTeams).toHaveBeenCalledTimes(3))
  })

  it('transfers leadership only to a selected active member and removes leader controls', async () => {
    teams.listMyLedManagerTeams.mockResolvedValueOnce([{ id: 'one', name: 'First team', status: 'active' }]).mockResolvedValue([])
    teams.listManagerTeamRoster.mockResolvedValue([{ id: 'membership-alex', name: 'Alex', role: 'member' }, { id: 'membership-me', name: 'Me', role: 'manager' }])
    renderTeams()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change team leader' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Change team leader' }))
    // A synchronous click immediately followed by a query can occasionally
    // race the transfer form's own render (same class of timing issue as
    // the Members-tab race above) -- wait for it rather than assume it's
    // already committed.
    fireEvent.change(await screen.findByLabelText('New team leader'), { target: { value: 'membership-alex' } })
    expect(screen.queryByRole('option', { name: 'Me' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Transfer leadership' }))
    await screen.findByText('Team leader changed. You are now a member of this team.')
    expect(teams.transferManagerTeamLeadership).toHaveBeenCalledWith('one', 'membership-alex')
    expect(screen.queryByRole('button', { name: 'Change team leader' })).not.toBeInTheDocument()
    // Let the reload the transfer triggers fully settle before the test ends,
    // so its promises can't resolve mid-flight into the next test.
    await waitFor(() => expect(teams.listMyLedManagerTeams).toHaveBeenCalledTimes(2))
  })

  it('keeps selection and displays failed invitations for retry', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }])
    teams.inviteConnectionToManagerTeam.mockRejectedValue(new Error('Could not send invitation'))
    renderTeams()
    await screen.findByRole('heading', { name: 'First team' })
    await inviteConnection('alex')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send invitation')
    expect(screen.getByLabelText('Add a connection')).toHaveValue('alex')
  })
})
