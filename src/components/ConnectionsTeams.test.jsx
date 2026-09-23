import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionsTeams from './ConnectionsTeams'
import * as teams from '../lib/managerTeams'
import { LanguageProvider } from '../context/LanguageContext'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, workspaces: [], refreshWorkspaces: async () => {} }) }))
vi.mock('../context/PendingActionsContext', () => ({ usePendingActions: () => ({ refreshPendingActionCount: vi.fn() }) }))
vi.mock('../lib/skillEvidence', () => ({ uploadEvidenceFiles: vi.fn() }))
vi.mock('../lib/skillLibrary', () => ({ listLibrarySkills: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/managerTeams', () => ({
  createManagerWorkspace: vi.fn(), createManagerTeam: vi.fn(), listMyLedManagerTeams: vi.fn(),
  listMyArchivedManagerTeams: vi.fn(), listMyManagerTeamRelationships: vi.fn(), listMyManagerShareableSkills: vi.fn(),
  listManagerTeamMembers: vi.fn(), listManagerTeamRoster: vi.fn(),
  inviteConnectionToManagerTeam: vi.fn(), inviteManagerTeamMemberByEmail: vi.fn(),
  transferManagerTeamLeadership: vi.fn(), listManagerTeamMemberSummaries: vi.fn(),
  listManagerTeamLearningRecords: vi.fn(), listManagerCollaborationRecords: vi.fn(),
  createManagerCollaborationRecord: vi.fn(), createManagerTeamSkillAssessment: vi.fn(),
  setManagerTeamSkillAssessmentEvidence: vi.fn(), listManagerTeamSkillAssessments: vi.fn(),
  getManagerTeamSkillDetail: vi.fn(), setManagerTeamSkillTarget: vi.fn(),
  archiveManagerTeam: vi.fn(), restoreManagerTeam: vi.fn(),
  setManagerTeamSharedSkills: vi.fn(), leaveManagerTeam: vi.fn(),
  listManagerTeamPendingMembers: vi.fn(), revokeManagerTeamInvite: vi.fn(),
  suggestManagerTeamSkill: vi.fn(),
  listManagerTeamSkills: vi.fn(), addManagerTeamSkill: vi.fn(), removeManagerTeamSkill: vi.fn(),
  decideManagerTeamInvite: vi.fn(), resendManagerTeamInvite: vi.fn(), updateManagerTeamDetails: vi.fn(),
  listManagerTeamSkillsForMember: vi.fn(),
}))
const connections = [{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
function renderTeams(props = {}, { initialEntries = ['/connections?section=teams'] } = {}) {
  return render(<MemoryRouter initialEntries={initialEntries}><LanguageProvider><ConnectionsTeams connections={connections} currentUserName="Russell" {...props} /></LanguageProvider></MemoryRouter>)
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
  teams.listManagerTeamPendingMembers.mockResolvedValue([])
  teams.listManagerTeamSkills.mockResolvedValue([])
  teams.listManagerTeamSkillsForMember.mockResolvedValue([])
  teams.createManagerWorkspace.mockResolvedValue('workspace')
  teams.createManagerTeam.mockResolvedValue('new-team')
  teams.inviteConnectionToManagerTeam.mockResolvedValue('invite')
  teams.inviteManagerTeamMemberByEmail.mockResolvedValue({ ok: true, userId: 'new-user', alreadyExisted: false })
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

// Opens the Members tab's "Invite to team" dialog and ticks an existing
// connection -- the flow this merged component now shares with the former
// standalone manager console (ManagerTeamPanel, reused verbatim here).
async function inviteConnection(name) {
  fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
  // A team switch (including the one right after creating it) resets the
  // active panel back to Skills, which can otherwise race a click that
  // follows immediately -- wait for Members to actually land as selected.
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 })
  fireEvent.click(await screen.findByRole('button', { name: 'Invite to team' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('checkbox', { name }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }))
}

describe('Connections teams', () => {
  it('lets a user without a manager workspace create a team and invite a connection', async () => {
    renderTeams()
    await screen.findByText(/No teams yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Create a team' }))
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Coaching circle' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create team', exact: true }))
    await screen.findByText('Team created. Invite people to get started.')
    // Even a single team shows as a card in the list, plus a heading for the open one.
    expect(screen.getByRole('heading', { name: 'Coaching circle' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Your teams' })).getByRole('button', { name: /Coaching circle/ })).toHaveAttribute('aria-pressed', 'true')
    // A brand-new team with nobody in it lands on Members, where inviting happens.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByText('Getting your team started')).toBeInTheDocument()
    await inviteConnection('Alex')
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
    fireEvent.click(screen.getByRole('button', { name: 'Create a team' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Create a team' }))
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

  it('shows the merged team console (Skills/Members/Learning/Collaboration) for a led team, remembering the tab per team', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }, { id: 'two', name: 'Second team', status: 'active' }])
    teams.listManagerTeamMemberSummaries.mockResolvedValue([{ id: 'm1', name: 'Alex', sharedSkills: [{ id: 's1', name: 'Welding', level: 2 }] }])
    renderTeams()
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('one'))
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true')
    // Nothing left to set up, so no checklist.
    expect(screen.queryByText('Getting your team started')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Learning' }))
    expect(screen.getByText(/Courses and sessions your team has done together/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Second team/ }))
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    // A team not visited yet opens on Skills...
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true'))
    // ...and going back returns to the tab last used there.
    fireEvent.click(screen.getByRole('button', { name: /First team/ }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Learning' })).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledTimes(3))
  })

  it('opens the team and tab named in the URL', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }, { id: 'two', name: 'Second team', status: 'active' }])
    renderTeams({ initialTeamId: 'two' }, { initialEntries: ['/connections?section=teams&team=two&tab=collaboration'] })
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    expect(screen.getByRole('button', { name: /Second team/ })).toHaveAttribute('aria-pressed', 'true')
    // An explicit ?tab= wins over steering an empty team to Members.
    await waitFor(() => expect(teams.listManagerTeamSkills).toHaveBeenCalledWith('two'))
    expect(screen.getByRole('tab', { name: 'Collaboration' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows a pending invitee on the Members tab and lets the leader revoke it after confirming', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }])
    teams.listManagerTeamPendingMembers.mockResolvedValue([{ id: 'p1', name: 'Sam Rivera', avatarUrl: null, invitedAt: '2026-08-01' }])
    teams.revokeManagerTeamInvite.mockResolvedValue()
    renderTeams()
    fireEvent.click(await screen.findByRole('tab', { name: 'Members' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 })
    expect(await screen.findByText('Sam Rivera')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(teams.revokeManagerTeamInvite).toHaveBeenCalledWith('p1'))
  })

  it('invites a batch of email addresses to a led team, whether or not they already have an account', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }])
    renderTeams()
    fireEvent.click(await screen.findByRole('tab', { name: 'Members' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 })
    fireEvent.click(await screen.findByRole('button', { name: 'Invite to team' }))
    fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'newperson@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add another' }))
    fireEvent.change(screen.getByLabelText('Email 2'), { target: { value: 'existing@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 invites' }))
    await waitFor(() => expect(teams.inviteManagerTeamMemberByEmail).toHaveBeenCalledWith('one', 'newperson@example.com'))
    expect(teams.inviteManagerTeamMemberByEmail).toHaveBeenCalledWith('one', 'existing@example.com')
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
    const list = screen.getByRole('list', { name: 'Your teams' })
    expect(within(list).getByRole('button', { name: /Book group.*Led by Pat/ })).toBeInTheDocument()
    expect(within(list).getAllByText('You lead')).toHaveLength(2)
    // ...while a merely-pending invitation stays in its own separate list, not selectable.
    expect(within(list).queryByText(/Study group/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept invitation to Study group' })).toBeInTheDocument()

    fireEvent.click(within(list).getByRole('button', { name: /Second team/ }))
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    const summariesCallsBeforeInvite = teams.listManagerTeamMemberSummaries.mock.calls.length
    await inviteConnection('Sam')
    await waitFor(() => expect(teams.inviteConnectionToManagerTeam).toHaveBeenCalledWith('two', 'sam'))
    // Let the invite's own reload fully settle before the test ends, so its
    // promises can't resolve mid-flight into the next test.
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries.mock.calls.length).toBeGreaterThan(summariesCallsBeforeInvite))
  })

  it('accepts an invitation in place and opens the share-skills picker for the newly joined team', async () => {
    teams.listMyManagerTeamRelationships.mockResolvedValue([
      { id: 'pending', teamId: 'study-team', teamName: 'Study group', managerName: 'Jo', status: 'pending', teamStatus: 'active', sharedSkillIds: [] },
    ])
    teams.listMyManagerShareableSkills.mockResolvedValue([{ id: 'skill-1', name: 'Welding', level: 3, evidenceCount: 0 }])
    teams.decideManagerTeamInvite.mockResolvedValue()
    renderTeams()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation to Study group' }))
    await waitFor(() => expect(teams.decideManagerTeamInvite).toHaveBeenCalledWith('pending', true))
    expect(await screen.findByText('You joined Study group. Choose which skills to share with Jo.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Study group' })).toBeInTheDocument()
    expect(await screen.findByRole('dialog')).toHaveTextContent('Choose skills to share')
    expect(screen.queryByRole('button', { name: /Accept invitation/ })).not.toBeInTheDocument()
  })

  it('declines an invitation in place', async () => {
    teams.listMyManagerTeamRelationships.mockResolvedValue([
      { id: 'pending', teamId: 'study-team', teamName: 'Study group', managerName: 'Jo', status: 'pending', teamStatus: 'active', sharedSkillIds: [] },
    ])
    teams.decideManagerTeamInvite.mockResolvedValue()
    renderTeams()
    fireEvent.click(await screen.findByRole('button', { name: 'Decline invitation to Study group' }))
    await waitFor(() => expect(teams.decideManagerTeamInvite).toHaveBeenCalledWith('pending', false))
    await waitFor(() => expect(screen.queryByText('Study group')).not.toBeInTheDocument())
  })

  it("renders a joined team's member view (share skills, roster, leave team) instead of the leader console", async () => {
    teams.listMyManagerTeamRelationships.mockResolvedValue([
      { id: 'membership-1', teamId: 'book-team', teamName: 'Book group', managerName: 'Pat', status: 'active', teamStatus: 'active', sharedSkillIds: [] },
    ])
    teams.listMyManagerShareableSkills.mockResolvedValue([{ id: 'skill-1', name: 'Welding', level: 3, evidenceCount: 0 }])
    teams.listManagerTeamRoster.mockResolvedValue([{ id: 'r1', name: 'Pat', avatarUrl: null, role: 'manager', memberSince: '2026-01-01' }])
    renderTeams()
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
    // Archive/restore and change-leader live under the Settings tab.
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Archive team' })).not.toBeDisabled())
    // Still fully interactive while active.
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 })
    expect(await screen.findByRole('button', { name: 'Invite to team' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive team' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive team' }))
    await waitFor(() => expect(teams.archiveManagerTeam).toHaveBeenCalledWith('one'))
    await screen.findByText(/Team archived/)

    // Once archived: no invite/change-leader controls, but still viewable, with
    // a restore option -- and archiving must not bounce the leader off the
    // Settings tab they were already on.
    expect(await screen.findByText(/This team has been archived/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Change team leader' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
    expect(screen.queryByRole('button', { name: 'Invite to team' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change team leader' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Change team leader' }))
    // A synchronous click immediately followed by a query can occasionally
    // race the transfer form's own render (same class of timing issue as
    // the Members-tab race above) -- wait for it rather than assume it's
    // already committed.
    fireEvent.change(await screen.findByLabelText('New team leader', {}, { timeout: 3000 }), { target: { value: 'membership-alex' } })
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
    await inviteConnection('Alex')
    expect(await screen.findByRole('alert')).toHaveTextContent('Alex: Could not send invitation')
    expect(screen.getByRole('checkbox', { name: 'Alex' })).toBeChecked()
  })

  it("never shows a slow-loading team's members under another team the leader has since switched to", async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }, { id: 'two', name: 'Second team', status: 'active' }])
    let resolveOne
    teams.listManagerTeamMemberSummaries.mockImplementation((id) => id === 'one'
      ? new Promise((resolve) => { resolveOne = resolve })
      : Promise.resolve([{ id: 'm2', name: 'Bea', sharedSkills: [] }]))
    renderTeams()
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('one'))
    fireEvent.click(screen.getByRole('button', { name: /Second team/ }))
    await waitFor(() => expect(teams.listManagerTeamMemberSummaries).toHaveBeenCalledWith('two'))
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
    expect(await screen.findByText('Bea')).toBeInTheDocument()
    await act(async () => { resolveOne([{ id: 'm1', name: 'Ada', sharedSkills: [] }]) })
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
    expect(screen.getByText('Bea')).toBeInTheDocument()
  })

  it('lets a leader rename a team and add a description from Settings', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'My team', description: null, status: 'active' }])
    teams.updateManagerTeamDetails.mockResolvedValue()
    renderTeams()
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true'), { timeout: 3000 })
    const nameField = await screen.findByLabelText('Team name')
    expect(nameField).toHaveValue('My team')
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled()
    fireEvent.change(nameField, { target: { value: 'Design crew' } })
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Getting better at research' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(teams.updateManagerTeamDetails).toHaveBeenCalledWith('one', { name: 'Design crew', description: 'Getting better at research' }))
    expect(await screen.findByRole('heading', { name: 'Design crew' })).toBeInTheDocument()
    expect(screen.getByText('Getting better at research', { selector: 'p' })).toBeInTheDocument()
  })

  it('resends a pending invitation from the Members tab', async () => {
    teams.listMyLedManagerTeams.mockResolvedValue([{ id: 'one', name: 'First team', status: 'active' }])
    teams.listManagerTeamPendingMembers.mockResolvedValue([{ id: 'p1', name: 'Sam Rivera', avatarUrl: null, invitedAt: '2026-08-01' }])
    teams.resendManagerTeamInvite.mockResolvedValue({ ok: true })
    renderTeams()
    fireEvent.click(await screen.findByRole('tab', { name: 'Members' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invitation to Sam Rivera' }))
    await waitFor(() => expect(teams.resendManagerTeamInvite).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('Invitation sent again.')).toBeInTheDocument()
  })

  it("shows a member the team's tracked skills and shares a matching one in one click", async () => {
    teams.listMyManagerTeamRelationships.mockResolvedValue([
      { id: 'membership-1', teamId: 'book-team', teamName: 'Book group', managerName: 'Pat', status: 'active', teamStatus: 'active', sharedSkillIds: [] },
    ])
    teams.listMyManagerShareableSkills.mockResolvedValue([{ id: 'skill-1', name: 'Welding', level: 3, evidenceCount: 0 }])
    teams.listManagerTeamSkillsForMember.mockResolvedValue([
      { id: 't1', skillLibraryId: 'lib-1', skillName: 'welding' },
      { id: 't2', skillLibraryId: 'lib-2', skillName: 'Soldering' },
    ])
    renderTeams()
    expect(await screen.findByText('Skills this team is working on')).toBeInTheDocument()
    expect(screen.getByText('Not on your profile yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Share Welding with Pat' }))
    await waitFor(() => expect(teams.setManagerTeamSharedSkills).toHaveBeenCalledWith('membership-1', ['skill-1']))
    expect(await screen.findByText('Shared')).toBeInTheDocument()
  })
})
