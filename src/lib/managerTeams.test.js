import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc, from } }))

const { createManagerTeam, inviteConnectionToManagerTeam, setManagerTeamSharedSkills } = await import('./managerTeams')

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
})
