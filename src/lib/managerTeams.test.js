import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))

const {
  createManagerCollaborationRecord,
  createManagerTeam,
  inviteConnectionToManagerTeam,
  inviteConnectionToManagerTeamByEmail,
  listManagerTeamMemberSummaries,
  listMyManagerTeamRelationships,
  leaveManagerTeam,
  setManagerTeamSharedSkills,
} = await import('./managerTeams')

describe('manager team service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a team through the permission-checked RPC', async () => {
    rpc.mockResolvedValue({ data: 'team-1', error: null })
    await expect(createManagerTeam('workspace-1', { name: 'Mentoring', description: 'Peer learning' })).resolves.toBe('team-1')
    expect(rpc).toHaveBeenCalledWith('create_manager_team', {
      p_workspace_id: 'workspace-1', p_name: 'Mentoring', p_description: 'Peer learning',
    })
  })

  it('uses the connection-gated invitation RPC', async () => {
    rpc.mockResolvedValue({ data: 'membership-1', error: null })
    await inviteConnectionToManagerTeam('team-1', 'user-2')
    expect(rpc).toHaveBeenCalledWith('invite_connection_to_manager_team', {
      p_team_id: 'team-1', p_member_user_id: 'user-2',
    })
  })

  it('shares an explicit skill allow-list instead of a profile id', async () => {
    rpc.mockResolvedValue({ error: null })
    await setManagerTeamSharedSkills('membership-1', ['skill-1'])
    expect(rpc).toHaveBeenCalledWith('set_manager_team_shared_skills', {
      p_membership_id: 'membership-1', p_skill_ids: ['skill-1'],
    })
  })

  it('resolves email invitations only through the connection-gated RPC', async () => {
    rpc.mockResolvedValue({ data: 'membership-2', error: null })
    await inviteConnectionToManagerTeamByEmail('team-1', 'person@example.com')
    expect(rpc).toHaveBeenCalledWith('invite_connection_to_manager_team_by_email', {
      p_team_id: 'team-1', p_email: 'person@example.com',
    })
  })

  it('maps the narrow member summary projection to the console model', async () => {
    rpc.mockResolvedValue({ data: [{
      id: 'membership-1', name: 'Taylor', avatar_url: null, team_since: '2026-09-03',
      shared_skills: [{ id: 'skill-1' }], collaborative_learning_count: 2,
    }], error: null })
    await expect(listManagerTeamMemberSummaries('team-1')).resolves.toEqual([{
      id: 'membership-1', name: 'Taylor', avatarUrl: null, teamSince: '2026-09-03',
      sharedSkills: [{ id: 'skill-1' }], collaborativeLearningCount: 2,
    }])
  })

  it('creates collaboration records with membership ids, not learner profile ids', async () => {
    rpc.mockResolvedValue({ data: 'record-1', error: null })
    await createManagerCollaborationRecord('team-1', {
      title: 'Goal', note: 'Practise together', memberIds: ['membership-1'],
    })
    expect(rpc).toHaveBeenCalledWith('create_manager_collaboration_record', {
      p_team_id: 'team-1', p_title: 'Goal', p_note: 'Practise together',
      p_membership_ids: ['membership-1'],
    })
  })

  it('maps only the current learner manager-team relationships', async () => {
    rpc.mockResolvedValue({ data: [{
      id: 'membership-1', status: 'active', team_id: 'team-1', team_name: 'My team',
      manager_name: 'Morgan', invited_at: '2026-09-01', joined_at: '2026-09-02',
      shared_skill_ids: ['skill-1'],
    }], error: null })
    await expect(listMyManagerTeamRelationships()).resolves.toEqual([{
      id: 'membership-1', status: 'active', teamId: 'team-1', teamName: 'My team',
      managerName: 'Morgan', invitedAt: '2026-09-01', joinedAt: '2026-09-02',
      sharedSkillIds: ['skill-1'],
    }])
  })

  it('leaves a team through the learner-authorised RPC', async () => {
    rpc.mockResolvedValue({ error: null })
    await leaveManagerTeam('membership-1')
    expect(rpc).toHaveBeenCalledWith('leave_manager_team', { p_membership_id: 'membership-1' })
  })
})
