import { describe, expect, it, vi } from 'vitest'
import { belongsToOrganisation, listOrganisationGoals, shapeOrganisationGoals, shapeOrganisationSkills } from './workspacePanels'
import { supabase } from './supabaseClient'

vi.mock('./supabaseClient', () => ({ supabase: { from: vi.fn() } }))

const ORG = 'org-1'
const SKILLS = [
  { id: 'skill-a', name: 'Data analysis', level: 3, library_skill_id: 'lib-a' },
  { id: 'skill-b', name: 'Giving feedback', level: 2, library_skill_id: 'lib-b' },
]

function goal(overrides) {
  return {
    id: 'goal', context_type: 'organisation', employer_id: ORG, context_name: 'Acme',
    skill_id: null, skill_library_id: 'lib-a', target_level: 4, target_date: '2027-01-01',
    status: 'active', created_at: '2026-10-01T00:00:00Z', skills: null, skill_library: { name: 'Data analysis' },
    ...overrides,
  }
}

describe('belongsToOrganisation', () => {
  it('only counts rows set in this organisation’s own context', () => {
    expect(belongsToOrganisation(goal({}), ORG)).toBe(true)
    expect(belongsToOrganisation(goal({ employer_id: 'org-2' }), ORG)).toBe(false)
    expect(belongsToOrganisation(goal({ context_type: 'team', employer_id: null }), ORG)).toBe(false)
    expect(belongsToOrganisation(goal({}), null)).toBe(false)
  })
})

describe('shapeOrganisationGoals', () => {
  const rows = [
    goal({ id: 'later', target_date: '2027-06-01' }),
    goal({ id: 'sooner', target_date: '2027-02-01', skill_library_id: 'lib-b', skill_library: { name: 'Giving feedback' } }),
    goal({ id: 'done', status: 'completed', target_date: '2026-01-01' }),
    goal({ id: 'cancelled', status: 'cancelled' }),
    goal({ id: 'other-org', employer_id: 'org-2' }),
    goal({ id: 'team', context_type: 'team', employer_id: null }),
  ]

  it('shows this organisation’s open goals, soonest due first, with the member’s current level', () => {
    const goals = shapeOrganisationGoals(rows, SKILLS, ORG)
    expect(goals.map((g) => g.id)).toEqual(['sooner', 'later'])
    expect(goals[0]).toMatchObject({ skillName: 'Giving feedback', targetLevel: 4, currentLevel: 2 })
  })

  it('adds completed goals after the open ones when set to show all, and keeps to the limit', () => {
    expect(shapeOrganisationGoals(rows, SKILLS, ORG, { show: 'all' }).map((g) => g.id)).toEqual(['sooner', 'later', 'done'])
    expect(shapeOrganisationGoals(rows, SKILLS, ORG, { show: 'all', limit: 1 }).map((g) => g.id)).toEqual(['sooner'])
  })

  it('has no current level for a skill the member doesn’t track', () => {
    const [only] = shapeOrganisationGoals([goal({ skill_library_id: 'lib-z', skill_library: { name: 'Coding' } })], SKILLS, ORG)
    expect(only).toMatchObject({ skillName: 'Coding', currentLevel: null })
  })
})

describe('shapeOrganisationSkills', () => {
  const ratings = [
    { context_type: 'organisation', employer_id: ORG, skill_id: null, skill_library_id: 'lib-a', level: 3, rated_at: '2026-11-01T00:00:00Z', skill_library: { name: 'Data analysis' } },
    { context_type: 'organisation', employer_id: ORG, skill_id: 'skill-a', skill_library_id: 'lib-a', level: 2, rated_at: '2026-06-01T00:00:00Z', skills: { name: 'Data analysis' } },
    { context_type: 'organisation', employer_id: 'org-2', skill_id: null, skill_library_id: 'lib-b', level: 5, rated_at: '2026-11-20T00:00:00Z', skill_library: { name: 'Giving feedback' } },
  ]
  const targets = [
    goal({ skill_library_id: 'lib-b', skill_library: { name: 'Giving feedback' }, target_level: 3, created_at: '2026-11-10T00:00:00Z' }),
    goal({ skill_library_id: 'lib-a', target_level: 4, created_at: '2026-09-01T00:00:00Z' }),
    goal({ skill_library_id: 'lib-c', status: 'completed', skill_library: { name: 'Presenting' } }),
  ]

  it('lists each skill once, most recently rated or given a goal first, from this organisation only', () => {
    const skills = shapeOrganisationSkills(ratings, targets, SKILLS, ORG)
    expect(skills.map((s) => s.skillName)).toEqual(['Giving feedback', 'Data analysis'])
    expect(skills[0]).toMatchObject({ ratedLevel: null, goalLevel: 3, currentLevel: 2 })
    expect(skills[1]).toMatchObject({ ratedLevel: 3, ratedAt: '2026-11-01T00:00:00Z', goalLevel: 4, currentLevel: 3 })
  })

  it('keeps to the limit', () => {
    expect(shapeOrganisationSkills(ratings, targets, SKILLS, ORG, { limit: 1 })).toHaveLength(1)
  })
})

describe('listOrganisationGoals', () => {
  it('asks only for the member’s goals in this organisation', async () => {
    const calls = []
    function query(result) {
      const chain = {
        select: () => chain,
        eq: (column, value) => { calls.push([column, value]); return chain },
        in: () => chain,
        or: () => chain,
        then: (resolve) => resolve(result),
      }
      return chain
    }
    supabase.from.mockImplementation((table) => query(table === 'skills' ? { data: SKILLS, error: null } : { data: [goal({})], error: null }))
    const goals = await listOrganisationGoals('user-1', ORG, { limit: 5 })
    expect(goals).toHaveLength(1)
    expect(calls).toEqual(expect.arrayContaining([['learner_id', 'user-1'], ['employer_id', ORG], ['user_id', 'user-1']]))
  })
})
