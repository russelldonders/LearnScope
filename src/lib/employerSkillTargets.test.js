import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [], calls: [] }))

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (table) => {
      state.calls.push(['from', table])
      const chain = {
        select: () => chain,
        eq: (column, value) => { state.calls.push(['eq', column, value]); return chain },
        in: (column, values) => { state.calls.push(['in', column, values]); return chain },
        order: async () => ({ data: state.rows, error: null }),
      }
      return chain
    },
  },
}))

const { listEmployerSkillConfirmations } = await import('./employerSkillTargets')

beforeEach(() => {
  state.rows = []
  state.calls = []
})

describe('listEmployerSkillConfirmations', () => {
  it("reads only the organisation's ratings from the unified table", async () => {
    await listEmployerSkillConfirmations('org-1', ['user-1'], ['lib-1'])
    expect(state.calls).toEqual([
      ['from', 'manager_skill_ratings'],
      ['eq', 'context_type', 'organisation'],
      ['eq', 'employer_id', 'org-1'],
      ['in', 'learner_id', ['user-1']],
      ['in', 'skill_library_id', ['lib-1']],
    ])
  })

  it('keeps the latest level per learner and skill', async () => {
    state.rows = [
      { learner_id: 'user-1', skill_library_id: 'lib-1', level: 4, rated_at: '2026-09-02' },
      { learner_id: 'user-1', skill_library_id: 'lib-1', level: 2, rated_at: '2026-08-01' },
      { learner_id: 'user-2', skill_library_id: 'lib-1', level: 3, rated_at: '2026-08-15' },
    ]
    expect(await listEmployerSkillConfirmations('org-1', ['user-1', 'user-2'], ['lib-1'])).toEqual({
      'user-1:lib-1': 4,
      'user-2:lib-1': 3,
    })
  })

  it('skips the query when there is nothing to look up', async () => {
    expect(await listEmployerSkillConfirmations('org-1', [], ['lib-1'])).toEqual({})
    expect(state.calls).toEqual([])
  })
})
