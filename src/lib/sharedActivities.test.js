import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const {
  matchingSkills,
  sharedCardProblem,
  sharedCardStatement,
  sharedCardsFromDraft,
  sharedCopyStatement,
} = await import('./sharedActivities')
const { SHARED_WITH_EXTENSION_IRI, SKILL_EXTENSION_IRI, sharedWithFromStatement } = await import('./xapiStatement')
const { localDateString } = await import('./skillGoalProgress')

const mine = [
  { id: 'my-sql', name: 'SQL', library_skill_id: 'lib-sql' },
  { id: 'my-writing', name: 'Writing', library_skill_id: 'lib-writing' },
]
const theirs = [
  { id: 'their-speaking', name: 'Public speaking', library_skill_id: 'lib-speaking' },
  { id: 'their-sql', name: 'SQL', library_skill_id: 'lib-sql' },
]
const actor = { name: 'Ana', email: 'ana@example.com' }
const connection = { id: 'ben', name: 'Ben' }

function card(overrides = {}) {
  return {
    key: 'c1', kind: 'joint', title: 'Paired on SQL', date: localDateString(), durationMinutes: '60',
    verb: 'practiced', mySkills: [mine[0]], theirSkills: [theirs[1]], note: '', ...overrides,
  }
}

describe('sharedCardsFromDraft', () => {
  it('reads who did it and maps both skill lists back', () => {
    const [together, observed] = sharedCardsFromDraft({
      activities: [
        { title: 'Paired on SQL', date: '2026-11-18', duration_minutes: 60, verb: 'practiced', skills: [0], their_skills: [1], note: null, done_by: 'together' },
        { title: 'Board talk', date: '2026-11-17', duration_minutes: null, verb: 'experienced', skills: [], their_skills: [0, 9], note: 'Very clear', done_by: 'them' },
      ],
    }, mine, theirs)
    expect(together).toMatchObject({ kind: 'joint', durationMinutes: '60', mySkills: [mine[0]], theirSkills: [theirs[1]] })
    expect(observed).toMatchObject({ kind: 'observed', durationMinutes: '', mySkills: [], theirSkills: [theirs[0]], note: 'Very clear' })
  })
})

describe('sharedCardStatement', () => {
  it('saves something done together on your own skills, tagged with them', () => {
    const { statement, skillIds } = sharedCardStatement(card(), { actor, connection })
    expect(skillIds).toEqual(['my-sql'])
    expect(statement.context.extensions[SKILL_EXTENSION_IRI]).toEqual([{ id: 'my-sql', name: 'SQL' }])
    expect(sharedWithFromStatement(statement)).toEqual({ name: 'Ben', kind: 'joint', skills: [{ libraryId: 'lib-sql', name: 'SQL' }] })
  })

  it('keeps something you saw them do off your own skills, naming theirs', () => {
    const { statement, skillIds } = sharedCardStatement(card({ kind: 'observed', theirSkills: [theirs[0]] }), { actor, connection })
    expect(skillIds).toEqual([])
    expect(statement.context.extensions[SKILL_EXTENSION_IRI]).toBeUndefined()
    expect(statement.context.extensions[SHARED_WITH_EXTENSION_IRI].skills).toEqual([{ libraryId: 'lib-speaking', name: 'Public speaking' }])
  })
})

describe('sharedCardProblem', () => {
  it('asks for a title, a past date, whole minutes and who did it', () => {
    expect(sharedCardProblem(card())).toBeNull()
    expect(sharedCardProblem(card({ title: ' ' }))).toBe('quickLog.errorTitle')
    expect(sharedCardProblem(card({ date: '2999-01-01' }))).toBe('quickLog.errorDate')
    expect(sharedCardProblem(card({ durationMinutes: '1.5' }))).toBe('quickLog.errorDuration')
    expect(sharedCardProblem(card({ kind: 'rated' }))).toBe('sharedActivity.errorKind')
  })
})

describe('adding a shared activity to your own record', () => {
  const row = {
    id: 's1', kind: 'observed', title: 'Board talk', note: 'Very clear', duration: 'PT1H30M',
    happened_at: '2026-11-17T10:00:00Z', skills: [{ libraryId: 'lib-sql', name: 'SQL' }, { libraryId: 'lib-other', name: 'Other' }],
  }

  it('finds your own matching skills by library skill', () => {
    expect(matchingSkills(row, mine)).toEqual([mine[0]])
  })

  it('builds your own copy on your matching skills, saying who saw it', () => {
    const { statement, skillIds } = sharedCopyStatement(row, { actor: { name: 'Ben', email: 'ben@example.com' }, loggedByName: 'Ana', mySkills: mine })
    expect(skillIds).toEqual(['my-sql'])
    expect(statement.actor.mbox).toBe('mailto:ben@example.com')
    expect(statement.timestamp).toBe('2026-11-17T10:00:00.000Z')
    expect(statement.result.duration).toBe('PT1H30M')
    expect(sharedWithFromStatement(statement)).toMatchObject({ name: 'Ana', kind: 'observed', addedFrom: true })
  })
})
