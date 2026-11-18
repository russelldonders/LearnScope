import { describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [])

vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: vi.fn((name, args) => {
      calls.push({ name, args })
      return Promise.resolve({
        data: [
          { id: 'a1', role_profile_id: 'role-1', employer_member_id: 'm1', learner_user_id: 'u1', learner_name: 'Priya', status: 'linked', proposed_at: '2026-11-01', decided_at: '2026-11-02', learner_experience_id: 'e1', current_role_title: 'Coach', current_role_organization: 'Acme' },
          { id: 'a2', role_profile_id: 'role-2', employer_member_id: 'm2', learner_user_id: 'u2', learner_name: 'Owen', status: 'proposed', proposed_at: '2026-11-03', decided_at: null, learner_experience_id: null, current_role_title: null, current_role_organization: null },
          { id: 'a3', role_profile_id: 'role-1', employer_member_id: 'm3', learner_user_id: 'u3', learner_name: 'Sam', status: 'proposed', proposed_at: '2026-11-04', decided_at: null, learner_experience_id: null, current_role_title: null, current_role_organization: null },
        ],
        error: null,
      })
    }),
  },
}))

import { listEmployerRoleAssignmentsByProfile } from './employerRoleProfiles'

describe('listEmployerRoleAssignmentsByProfile', () => {
  it("loads every role's assignments in one call, grouped by role profile", async () => {
    const byProfile = await listEmployerRoleAssignmentsByProfile('employer-1')
    expect(calls).toEqual([{ name: 'list_employer_role_assignments_for_employer', args: { p_employer_id: 'employer-1' } }])
    expect(Object.keys(byProfile)).toEqual(['role-1', 'role-2'])
    expect(byProfile['role-1'].map((a) => a.id)).toEqual(['a1', 'a3'])
    expect(byProfile['role-1'][0]).toEqual({
      id: 'a1',
      memberId: 'm1',
      userId: 'u1',
      name: 'Priya',
      status: 'linked',
      proposedAt: '2026-11-01',
      linkedAt: '2026-11-02',
      currentRole: { id: 'e1', title: 'Coach', organization: 'Acme' },
    })
    expect(byProfile['role-2'][0].currentRole).toBeNull()
  })
})
