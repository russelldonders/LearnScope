import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [], updates: [], inserts: [] }))

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: state.rows, error: null }),
        update: (values) => ({ eq: async (column, id) => { state.updates.push({ table, values, id }); return { error: null } } }),
        insert: async (row) => { state.inserts.push({ table, row }); return { error: null } },
      }
      return chain
    },
  },
}))
vi.mock('./connections', () => ({
  getProfiles: async () => ({ leader: { name: 'Morgan' } }),
}))
vi.mock('./skillLibrary', () => ({
  findOrCreatePersonalSkill: async (userId, name) => ({ skill: { id: 'skill-1', name } }),
}))

const { listMyManagerSkillSuggestions, adoptManagerSkillSuggestion, dismissManagerSkillSuggestion, pickTargetSetByOthers } = await import('./managerSkillActions')

beforeEach(() => {
  state.updates = []
  state.inserts = []
  state.rows = [
    { id: 'n1', context_type: 'team', context_name: 'Coaching circle', skill_library_id: 'lib', skill_name: 'Facilitation',
      suggested_target_level: 4, target_date: '2027-01-01', comments: 'Focus', suggested_by: 'leader', created_at: '2026-09-07',
      legacy_source: 'manager_team_skill_suggestions', legacy_id: 'old-team-1' },
    { id: 'n2', context_type: 'organisation', context_name: 'Acme Ltd', skill_library_id: 'lib', skill_name: 'Negotiation',
      suggested_target_level: null, target_date: null, comments: null, suggested_by: 'admin', created_at: '2026-09-06',
      legacy_source: 'employer_skill_suggestions', legacy_id: 'old-org-1' },
  ]
})

describe('manager skill suggestions (learner side)', () => {
  it('lists team and organisation suggestions as one list with where each came from', async () => {
    const list = await listMyManagerSkillSuggestions('me')
    expect(list.map((s) => [s.skillName, s.sourceLabel])).toEqual([
      ['Facilitation', 'Morgan (Coaching circle)'],
      ['Negotiation', 'Acme Ltd'],
    ])
  })

  it('adopting adds the skill and the learner-reviewed target as their own, then marks the original suggestion', async () => {
    const [team] = await listMyManagerSkillSuggestions('me')
    await adoptManagerSkillSuggestion('me', team, { targetLevel: 3, targetDate: '2027-02-01', comments: ' mine ' })
    expect(state.inserts).toEqual([{ table: 'skill_targets', row: { skill_id: 'skill-1', user_id: 'me', target_level: 3, target_date: '2027-02-01', comments: 'mine' } }])
    expect(state.updates).toEqual([{ table: 'manager_team_skill_suggestions', values: { status: 'adopted' }, id: 'old-team-1' }])
  })

  it('dismissing only marks the original suggestion, never touching skills or targets', async () => {
    const [, org] = await listMyManagerSkillSuggestions('me')
    await dismissManagerSkillSuggestion(org)
    expect(state.inserts).toEqual([])
    expect(state.updates).toEqual([{ table: 'employer_skill_suggestions', values: { status: 'dismissed' }, id: 'old-org-1' }])
  })

  it('refuses a level without a date, and a suggestion with no original row', async () => {
    const [team] = await listMyManagerSkillSuggestions('me')
    await expect(adoptManagerSkillSuggestion('me', team, { targetLevel: 3 })).rejects.toThrow('Target date is required')
    await expect(dismissManagerSkillSuggestion({ ...team, legacySource: null })).rejects.toThrow('can no longer be updated')
  })
})

describe('pickTargetSetByOthers', () => {
  const team = { libraryId: null, skillId: 'skill-1', level: 3, contextType: 'team', contextKey: 'team:circle', contextName: 'Study circle' }
  const org = { libraryId: 'lib-1', skillId: null, level: 4, contextType: 'organisation', contextKey: 'organisation:acme', contextName: 'Acme' }
  const skill = { libraryId: 'lib-1', skillId: 'skill-1' }

  it('shows the highest target nobody from that context has rated as reached yet', () => {
    expect(pickTargetSetByOthers(skill, [team, org], new Map())).toEqual({ level: 4, met: false, contextType: 'organisation', contextName: 'Acme' })
  })

  it('only counts a target met by a rating from its own context', () => {
    // A team rating of 4 doesn't meet Acme's target of 4 -- only Acme's own rating can.
    const ratings = new Map([['team:circle|skill:skill-1', 4]])
    expect(pickTargetSetByOthers(skill, [team, org], ratings)).toMatchObject({ contextName: 'Acme', met: false })
    ratings.set('organisation:acme|lib-1', 4)
    expect(pickTargetSetByOthers(skill, [team, org], ratings)).toMatchObject({ level: 4, met: true })
  })

  it('treats a team target the same way: shown until the team rates it reached', () => {
    expect(pickTargetSetByOthers(skill, [team], new Map())).toMatchObject({ contextType: 'team', met: false })
    expect(pickTargetSetByOthers(skill, [team], new Map([['team:circle|skill:skill-1', 3]]))).toMatchObject({ contextType: 'team', met: true })
  })

  it('returns nothing when no one else set a target for this skill', () => {
    expect(pickTargetSetByOthers({ libraryId: 'other', skillId: 'other' }, [team, org], new Map())).toBeNull()
  })
})
