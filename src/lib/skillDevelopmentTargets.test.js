import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [])
const results = vi.hoisted(() => ({}))

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (table) => {
      const filters = []
      const chain = {
        select: () => chain,
        eq: (column, value) => { filters.push(['eq', column, value]); return chain },
        is: (column, value) => { filters.push(['is', column, value]); return chain },
        order: async () => { calls.push({ table, filters }); return results[table] },
      }
      return chain
    },
  },
}))

const { listMySkillDevelopmentTargets } = await import('./skillDevelopmentTargets')

beforeEach(() => {
  calls.length = 0
  results.skill_targets = {
    data: [
      { id: 'personal-new', skill_id: 'skill-1', target_level: 4, target_date: '2027-01-01', comments: 'New', created_at: '2026-09-21', skills: { id: 'skill-1', name: 'SQL' } },
      { id: 'personal-old', skill_id: 'skill-1', target_level: 3, target_date: '2026-10-01', comments: 'Old', created_at: '2026-08-01', skills: { id: 'skill-1', name: 'SQL' } },
    ],
    error: null,
  }
  results.manager_skill_targets = {
    data: [
      { id: 'org-1', context_type: 'organisation', employer_id: 'acme', team_id: null, context_name: 'Acme', skill_id: null, skill_library_id: 'lib-1',
        target_level: 5, target_date: '2027-02-01', notes: 'Lead the team', status: 'active', created_at: '2026-09-21', closed_at: null,
        skill_library: { name: 'Coaching' }, skills: null },
      { id: 'team-1', context_type: 'team', employer_id: null, team_id: 'circle', context_name: 'Study circle', skill_id: 'skill-1', skill_library_id: null,
        target_level: 3, target_date: '2026-12-01', notes: null, status: 'active', created_at: '2026-09-20', closed_at: null,
        skill_library: null, skills: { name: 'SQL' } },
    ],
    error: null,
  }
})

describe('skill development targets', () => {
  it('keeps the learner’s own latest target per skill separate from targets set by a team or organisation', async () => {
    const result = await listMySkillDevelopmentTargets('user-1')

    expect(result.personal).toHaveLength(1)
    expect(result.personal[0]).toMatchObject({ id: 'personal-new', ownership: 'personal', skillName: 'SQL' })
    expect(result.employer.map((t) => [t.contextType, t.employerName, t.skillName])).toEqual([
      ['organisation', 'Acme', 'Coaching'],
      ['team', 'Study circle', 'SQL'],
    ])
  })
})
