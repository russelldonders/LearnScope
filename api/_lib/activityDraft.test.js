import { describe, expect, it } from 'vitest'
import { buildActivityDraftRequest, normalizeActivityDraft } from './activityDraft.js'

const TODAY = '2026-11-08'
const skills = [{ name: 'Running' }, { name: 'Fitness' }, { name: 'Piano' }]
const goals = [
  { title: '5 km under 25 min', skill: 0, measure_kind: 'pace', unit: 'min/km', aggregation: 'best', tracker_question: 'How far and how long?' },
  { title: 'Push-ups best set', skill: 1, measure_kind: 'count', unit: 'push-ups', aggregation: 'best', tracker_question: 'Best set?' },
  { title: 'Run 3 times a week', skill: 0, measure_kind: 'activities', unit: 'activities', aggregation: 'total', tracker_question: 'What did you do?' },
  { title: 'Plank time', skill: 1, measure_kind: 'duration', unit: 'seconds', aggregation: 'best', tracker_question: 'How long?' },
]

function context(body = {}) {
  return buildActivityDraftRequest({ text: 'ran 5k', skills, goals, ...body }, TODAY).context
}

function activity(overrides = {}) {
  return {
    title: 'Morning run',
    date: TODAY,
    duration_minutes: null,
    verb: 'practiced',
    skills: [1],
    new_skill: null,
    goal_values: [],
    note: null,
    ...overrides,
  }
}

describe('buildActivityDraftRequest', () => {
  it('needs text and at least one skill', () => {
    expect(buildActivityDraftRequest({ skills }, TODAY).error).toBeTruthy()
    expect(buildActivityDraftRequest({ text: 'ran', skills: [] }, TODAY).error).toBeTruthy()
  })

  it('lists skills and only measured goals by number', () => {
    const { prompt } = buildActivityDraftRequest({ text: 'ran', skills, goals }, TODAY)
    expect(prompt).toContain('S1: Running')
    expect(prompt).toContain('G1: "5 km under 25 min" on Running')
    expect(prompt).toContain('G2: "Push-ups best set" on Fitness')
    expect(prompt).not.toContain('Run 3 times a week')
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('writes in the learner language and resolves their date', () => {
    const request = buildActivityDraftRequest({ text: 'ran', skills, language: 'de', today: '2026-11-09' }, TODAY)
    expect(request.prompt).toContain('in German')
    expect(request.today).toBe('2026-11-09')
  })
})

describe('normalizeActivityDraft', () => {
  it('maps skills and goal values back to list positions', () => {
    const draft = normalizeActivityDraft({
      outcome: 'activities',
      message: null,
      activities: [
        activity({ skills: [1], goal_values: [{ goal: 1, value: null, distance: 5, seconds: 1600 }] }),
        activity({ title: 'Push-ups', skills: [], goal_values: [{ goal: 2, value: 32, distance: null, seconds: null }] }),
      ],
    }, context())
    expect(draft.activities[0]).toMatchObject({ skills: [0], goal_values: [{ goal: 0, distance: 5, seconds: 1600 }], duration_minutes: 27 })
    // The goal's skill is added when the model left it out.
    expect(draft.activities[1]).toMatchObject({ skills: [1], goal_values: [{ goal: 1, value: 32 }] })
  })

  it('drops skills, goals and values that are not real', () => {
    const draft = normalizeActivityDraft({
      outcome: 'activities',
      activities: [activity({
        skills: [0, 9, 1, 1],
        goal_values: [
          { goal: 9, value: 3, distance: null, seconds: null },
          { goal: 2, value: 3.5, distance: null, seconds: null }, // a count must be whole
          { goal: 3, value: 1, distance: null, seconds: null }, // derived goals take no value
          { goal: 4, value: null, distance: null, seconds: -5 },
          { goal: 1, value: null, distance: 5, seconds: null }, // pace needs a time
        ],
      })],
    }, context())
    expect(draft.activities[0]).toMatchObject({ skills: [0], goal_values: [] })
  })

  it('keeps one value per goal', () => {
    const draft = normalizeActivityDraft({
      outcome: 'activities',
      activities: [activity({ goal_values: [
        { goal: 2, value: 30, distance: null, seconds: null },
        { goal: 2, value: 40, distance: null, seconds: null },
      ] })],
    }, context())
    expect(draft.activities[0].goal_values).toEqual([{ goal: 1, value: 30 }])
  })

  it('keeps dates real and never in the future', () => {
    const dates = ['2026-11-07', '2026-11-09', '2026-02-31', null].map((date) =>
      normalizeActivityDraft({ outcome: 'activities', activities: [activity({ date })] }, context()).activities[0].date,
    )
    expect(dates).toEqual(['2026-11-07', TODAY, TODAY, TODAY])
  })

  it('offers a new skill only when nothing matches, reusing an existing name', () => {
    const fresh = normalizeActivityDraft({ outcome: 'activities', activities: [activity({ skills: [], new_skill: 'Swimming' })] }, context())
    expect(fresh.activities[0]).toMatchObject({ skills: [], new_skill: 'Swimming' })
    const existing = normalizeActivityDraft({ outcome: 'activities', activities: [activity({ skills: [], new_skill: 'piano' })] }, context())
    expect(existing.activities[0]).toMatchObject({ skills: [2], new_skill: null })
    const ignored = normalizeActivityDraft({ outcome: 'activities', activities: [activity({ new_skill: 'Swimming' })] }, context())
    expect(ignored.activities[0].new_skill).toBeNull()
  })

  it('never names an activity after a private goal', () => {
    const draft = normalizeActivityDraft({ outcome: 'activities', activities: [activity({ title: 'Push-ups Best Set', skills: [2] })] }, context())
    expect(draft.activities[0].title).toBe('Fitness')
  })

  it('falls back to a safe verb and caps the number of activities', () => {
    const many = Array.from({ length: 8 }, () => activity({ verb: 'deleted' }))
    const draft = normalizeActivityDraft({ outcome: 'activities', activities: many }, context())
    expect(draft.activities).toHaveLength(5)
    expect(draft.activities[0].verb).toBe('experienced')
  })

  it('passes on a clarifying question and rejects unusable answers', () => {
    expect(normalizeActivityDraft({ outcome: 'clarify', message: 'Best set or total?', activities: [] }, context()))
      .toEqual({ outcome: 'clarify', message: 'Best set or total?' })
    expect(normalizeActivityDraft({ outcome: 'clarify', message: '' }, context())).toBeNull()
    expect(normalizeActivityDraft({ outcome: 'activities', activities: [activity({ title: ' ' })] }, context())).toBeNull()
    expect(normalizeActivityDraft({ outcome: 'other' }, context())).toBeNull()
  })
})
