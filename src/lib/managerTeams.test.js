import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))
const callAdminApi = vi.fn()
vi.mock('./admin/adminApi', () => ({ callAdminApi }))

const {
  createManagerCollaborationRecord,
  createManagerTeam,
  inviteConnectionToManagerTeam,
  inviteManagerTeamMemberByEmail,
  createManagerTeamSkillAssessment,
  listManagerTeamMemberSummaries,
  listManagerTeamRoster,
  listManagerTeamSkillAssessments,
  listMyManagerTeamRelationships,
  leaveManagerTeam,
  setManagerTeamSharedSkills,
  setManagerTeamSkillAssessmentEvidence,
  suggestManagerTeamSkill,
  listMyManagerTeamSkillSuggestions,
  dismissManagerTeamSkillSuggestion,
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

  it('invites someone by email through the service-role admin action, not a plain RPC', async () => {
    callAdminApi.mockResolvedValue({ ok: true, userId: 'user-2', alreadyExisted: false })
    await inviteManagerTeamMemberByEmail('team-1', 'person@example.com')
    expect(callAdminApi).toHaveBeenCalledWith('inviteManagerTeamMemberByEmail', {
      teamId: 'team-1', email: 'person@example.com',
    })
    expect(rpc).not.toHaveBeenCalled()
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

  it('maps the roster projection available to any active team participant', async () => {
    rpc.mockResolvedValue({ data: [{
      id: 'membership-manager', name: 'Dana', avatar_url: null, role: 'manager', member_since: '2026-05-01',
    }], error: null })
    await expect(listManagerTeamRoster('team-1')).resolves.toEqual([{
      id: 'membership-manager', name: 'Dana', avatarUrl: null, role: 'manager', memberSince: '2026-05-01',
    }])
    expect(rpc).toHaveBeenCalledWith('list_manager_team_roster', { p_team_id: 'team-1' })
  })

  it('creates a manager team skill assessment through the shared-skill-gated RPC', async () => {
    rpc.mockResolvedValue({ data: 'assessment-1', error: null })
    await expect(
      createManagerTeamSkillAssessment('membership-1', 'skill-1', { level: 4, comments: 'Great work' })
    ).resolves.toBe('assessment-1')
    expect(rpc).toHaveBeenCalledWith('create_manager_team_skill_assessment', {
      p_membership_id: 'membership-1', p_skill_id: 'skill-1', p_level: 4,
      p_comments: 'Great work', p_evidence_url: null,
    })
  })

  it('attaches evidence paths to a manager team skill assessment', async () => {
    rpc.mockResolvedValue({ error: null })
    await setManagerTeamSkillAssessmentEvidence('assessment-1', ['a/b/c.png'])
    expect(rpc).toHaveBeenCalledWith('set_manager_team_skill_assessment_evidence', {
      p_assessment_id: 'assessment-1', p_evidence_paths: ['a/b/c.png'],
    })
  })

  it('maps manager team skill assessment history to the console model', async () => {
    rpc.mockResolvedValue({ data: [{
      id: 'assessment-1', skill_id: 'skill-1', level: 4, comments: 'Great work',
      evidence_url: null, evidence_paths: ['a/b/c.png'], assessed_by_name: 'Dana', assessed_at: '2026-09-05',
    }], error: null })
    await expect(listManagerTeamSkillAssessments('membership-1')).resolves.toEqual([{
      id: 'assessment-1', skillId: 'skill-1', level: 4, comments: 'Great work',
      evidenceUrl: null, evidencePaths: ['a/b/c.png'], assessedByName: 'Dana', assessedAt: '2026-09-05',
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

  it('suggests a skill to a member through the leader-authorised RPC, without touching their own record', async () => {
    rpc.mockResolvedValue({ data: { id: 'suggestion-1' }, error: null })
    await suggestManagerTeamSkill('membership-1', 'lib-1', 'Facilitation', { targetLevel: 4, targetDate: '2027-01-01', comments: 'Focus area' })
    expect(rpc).toHaveBeenCalledWith('suggest_manager_team_skill', {
      p_membership_id: 'membership-1', p_skill_library_id: 'lib-1', p_skill_name: 'Facilitation',
      p_target_level: 4, p_target_date: '2027-01-01', p_comments: 'Focus area',
    })
  })

  it('maps only the current learner’s pending team skill suggestions', async () => {
    rpc.mockResolvedValue({ data: [{
      id: 'suggestion-1', membership_id: 'membership-1', skill_name: 'Facilitation',
      suggested_target_level: 4, target_date: '2027-01-01', comments: 'Focus area',
      status: 'suggested', created_at: '2026-09-07', team_name: 'Coaching circle', suggested_by_name: 'Morgan',
    }], error: null })
    await expect(listMyManagerTeamSkillSuggestions()).resolves.toEqual([{
      id: 'suggestion-1', membershipId: 'membership-1', skillName: 'Facilitation',
      suggestedTargetLevel: 4, targetDate: '2027-01-01', comments: 'Focus area',
      status: 'suggested', createdAt: '2026-09-07', teamName: 'Coaching circle', suggestedByName: 'Morgan',
    }])
  })

  it('dismisses a team skill suggestion without ever writing to skills/skill_targets', async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    from.mockReturnValue({ update })
    await dismissManagerTeamSkillSuggestion('suggestion-1')
    expect(from).toHaveBeenCalledWith('manager_team_skill_suggestions')
    expect(update).toHaveBeenCalledWith({ status: 'dismissed' })
  })
})
