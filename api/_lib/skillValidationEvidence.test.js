import { describe, expect, it } from 'vitest'
import { LEVEL_LABELS as CLIENT_LEVEL_LABELS } from '../../src/lib/levels'
import { SKILL_LIFECYCLE_LABELS, SKILL_LIFECYCLE_FLOW_STAGES, lifecycleWeight as clientWeight } from '../../src/lib/skillLifecycle'
import { LEVEL_LABELS, lifecycleWeight, loadValidationEvidence, toWeightedPeerRating } from './skillValidationEvidence.js'

// Minimal stand-in for the supabase-js query builder: each chained filter is
// applied to that table's rows, and awaiting the chain resolves { data }.
function fakeDb(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] ?? [])]
      let single = false
      const chain = {
        select: () => chain,
        eq: (column, value) => { rows = rows.filter((row) => row[column] === value); return chain },
        is: (column, value) => { rows = rows.filter((row) => (row[column] ?? null) === value); return chain },
        in: (column, values) => { rows = rows.filter((row) => values.includes(row[column])); return chain },
        or: (expression) => {
          if (expression === 'source.eq.self,source.is.null') rows = rows.filter((row) => row.source === 'self' || row.source == null)
          return chain
        },
        order: (column, { ascending }) => {
          rows.sort((a, b) => (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1))
          return chain
        },
        limit: (n) => { rows = rows.slice(0, n); return chain },
        maybeSingle: () => { single = true; return chain },
        then: (resolve) => resolve({ data: single ? rows[0] ?? null : rows, error: null }),
      }
      return chain
    },
  }
}

const OWNER = 'owner'
const SKILL = 'skill-1'

function baseTables(overrides = {}) {
  return {
    skills: [
      { id: SKILL, user_id: OWNER, name: 'Negotiation', library_skill_id: 'lib-1' },
      { id: 'rater-skill', user_id: 'rater-a', library_skill_id: 'lib-1', lifecycle_stage: 'validated' },
    ],
    skill_targets: [
      { skill_id: SKILL, user_id: OWNER, target_level: 2, created_at: '2026-01-01' },
      { skill_id: SKILL, user_id: OWNER, target_level: 4, created_at: '2026-06-01' },
    ],
    skill_assessments: [
      { skill_id: SKILL, user_id: OWNER, level: 3, comments: 'practical self', source: 'self', axis: 'practical', assessed_at: '2026-05-01' },
      { skill_id: SKILL, user_id: OWNER, level: 5, comments: 'knowledge self', source: 'self', axis: 'knowledge', assessed_at: '2026-07-01' },
      { skill_id: SKILL, user_id: OWNER, level: 5, source: 'course', axis: 'practical', assessed_at: '2026-08-01' },
    ],
    skill_peer_ratings: [
      { skill_id: SKILL, level: 4, comments: 'Solid', rater_id: 'rater-a', rated_at: '2026-04-01' },
      { skill_id: SKILL, level: 2, comments: null, rater_id: 'rater-b', rated_at: '2026-03-01' },
    ],
    xapi_statements: [
      { id: 's1', skill_id: SKILL, user_id: OWNER, recorded_at: '2026-02-01T10:00:00Z', statement: { verb: { display: { 'en-US': 'practised' } }, object: { definition: { name: { 'en-US': 'Mock deal' } } } } },
      { id: 's2', skill_id: SKILL, user_id: OWNER, recorded_at: '2026-02-02T10:00:00Z', statement: { result: { extensions: { 'https://learnscope.app/xapi/extensions/diagnostic': {} } } } },
      { id: 's3', skill_id: SKILL, user_id: 'someone-else', recorded_at: '2026-02-03T10:00:00Z', statement: {} },
    ],
    xapi_statement_skills: [],
    ...overrides,
  }
}

describe('skill validation evidence', () => {
  it('keeps the server copy of level labels and rater weights in step with the client', () => {
    expect(LEVEL_LABELS).toEqual(CLIENT_LEVEL_LABELS)
    for (const { value } of SKILL_LIFECYCLE_FLOW_STAGES) {
      expect(lifecycleWeight(value)).toBe(clientWeight(value))
      expect(toWeightedPeerRating({ level: 3 }, value).raterOwnStage).toBe(SKILL_LIFECYCLE_LABELS[value])
    }
    expect(lifecycleWeight(null)).toBe(clientWeight(null))
  })

  it('loads the target, practical self-assessment, activities and weighted ratings from the database', async () => {
    const evidence = await loadValidationEvidence(fakeDb(baseTables()), OWNER, SKILL)
    expect(evidence.skillName).toBe('Negotiation')
    expect(evidence.targetLevel).toBe('Skilled')
    expect(evidence.selfLevel).toBe('Capable')
    expect(evidence.selfComments).toBe('practical self')
    expect(evidence.activities).toEqual([{ verb: 'practised', activity: 'Mock deal', description: null, date: '2026-02-01' }])
    expect(evidence.peerRatings).toEqual([
      { level: 'Skilled', comments: 'Solid', raterTracksThisSkill: true, raterOwnStage: 'Maintaining', weight: 3 },
      { level: 'Developing', comments: null, raterTracksThisSkill: false, raterOwnStage: null, weight: 1 },
    ])
  })

  it("refuses another learner's skill and a skill with no target", async () => {
    expect(await loadValidationEvidence(fakeDb(baseTables()), 'intruder', SKILL)).toBeNull()
    expect(await loadValidationEvidence(fakeDb(baseTables({ skill_targets: [] })), OWNER, SKILL)).toBeNull()
    expect(await loadValidationEvidence(fakeDb(baseTables()), OWNER, 42)).toBeNull()
  })
})
