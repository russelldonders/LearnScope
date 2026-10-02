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
  it("reads the organisation's suggestions from the unified table, keeping the original ids", async () => {
    state.rows = [
      { id: 'unified-1', legacy_id: 'old-1', skill_name: 'Coaching', learner_id: 'user-1', status: 'suggested' },
      { id: 'unified-2', legacy_id: null, skill_name: 'Facilitation', learner_id: 'user-2', status: 'adopted' },
    ]
    const rows = await listEmployerSkillSuggestions('org-1')
    expect(state.calls).toEqual([
      ['from', 'manager_skill_suggestions'],
      ['eq', 'context_type', 'organisation'],
      ['eq', 'employer_id', 'org-1'],
    ])
    expect(rows).toEqual([
      { id: 'old-1', skill_name: 'Coaching', learner_id: 'user-1', status: 'suggested' },
      { id: 'unified-2', skill_name: 'Facilitation', learner_id: 'user-2', status: 'adopted' },
    ])
  })
})
