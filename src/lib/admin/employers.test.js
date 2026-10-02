import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rows: [], calls: [] }))

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table) => {
      state.calls.push(['from', table])
      const chain = {
        select: () => chain,
        eq: (column, value) => { state.calls.push(['eq', column, value]); return chain },
        order: async () => ({ data: state.rows, error: null }),
      }
      return chain
    },
  },
}))
vi.mock('./adminApi', () => ({ callAdminApi: vi.fn() }))

const { listEmployerSkillSuggestions } = await import('./employers')

describe('listEmployerSkillSuggestions', () => {
  it("reads only the organisation's suggestions from the unified table", async () => {
    state.rows = [{ id: 'suggestion-1', skill_name: 'Coaching', learner_id: 'user-1', status: 'suggested' }]
    expect(await listEmployerSkillSuggestions('org-1')).toEqual(state.rows)
    expect(state.calls).toEqual([
      ['from', 'manager_skill_suggestions'],
      ['eq', 'context_type', 'organisation'],
      ['eq', 'employer_id', 'org-1'],
    ])
  })
})
