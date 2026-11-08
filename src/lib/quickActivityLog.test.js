import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const { buildCardStatement, canRepeatRow, cardFromRow, cardFromTemplate, cardsFromDraft, derivedGoalsForCard, repeatTemplates, withReflection } = await import('./quickActivityLog')
const { DIAGNOSTIC_EXTENSION_IRI, MEASUREMENT_EXTENSION_IRI, buildStatement, measurementsFromStatement } = await import('./xapiStatement')
const { localDateString } = await import('./skillGoalProgress')

const running = { id: 'skill-run', name: 'Running' }
const fitness = { id: 'skill-fit', name: 'Fitness' }
const skills = [fitness, running]
const paceGoal = { id: 'goal-pace', skill_id: running.id, title: '5 km under 25 min', metric: '5km_pace', measure_kind: 'pace', unit: 'min/km', aggregation: 'best' }
const pushUpGoal = { id: 'goal-push', skill_id: fitness.id, title: '40 push-ups', metric: 'push_ups', measure_kind: 'count', unit: 'push-ups', aggregation: 'best' }
const runsGoal = { id: 'goal-runs', skill_id: running.id, title: 'Run 3 times a week', metric: 'activity_count', measure_kind: 'activities', unit: 'activities', aggregation: 'total' }
const practiceGoal = { id: 'goal-practice', skill_id: running.id, title: '2 hours a week', metric: 'practice_minutes', measure_kind: 'practice_time', unit: 'minutes', aggregation: 'total' }
const goals = [paceGoal, pushUpGoal, runsGoal, practiceGoal]
const actor = { name: 'Test', email: 'test@example.com' }

function card(overrides = {}) {
  return {
    key: 'k',
    title: 'Morning run',
    date: localDateString(),
    durationMinutes: '',
    verb: 'practiced',
    skills: [running],
    newSkill: null,
    goalValues: [],
    note: '',
    ...overrides,
  }
}

function row(id, statement, extra = {}) {
  return { id, statement, resource_id: null, ...extra }
}

function logged(name, relatedSkills, { minutes = 0, measurements } = {}) {
  return buildStatement({
    actor,
    verbValue: 'practiced',
    activityName: name,
    timestamp: new Date().toISOString(),
    relatedSkills,
    durationHours: Math.floor(minutes / 60),
    durationMinutes: minutes % 60,
    measurements,
  })
}

describe('cardsFromDraft', () => {
  it('turns list positions back into skills and goal fields', () => {
    const [first] = cardsFromDraft({
      activities: [{
        title: 'Run', date: '2026-11-07', duration_minutes: 27, verb: 'practiced', skills: [1], new_skill: null,
        goal_values: [{ goal: 0, distance: 5, seconds: 1650 }], note: null,
      }],
    }, skills, goals)
    expect(first).toMatchObject({
      title: 'Run',
      durationMinutes: '27',
      skills: [running],
      goalValues: [{ goalId: 'goal-pace', value: '', distance: '5', time: '27:30' }],
      note: '',
    })
  })
})

describe('buildCardStatement', () => {
  it('saves goal values as measurements on the activity', () => {
    const { statement, skillIds } = buildCardStatement(
      card({ durationMinutes: '28', goalValues: [{ goalId: 'goal-pace', value: '', distance: '5', time: '27:30' }] }),
      goals,
      actor,
    )
    expect(skillIds).toEqual([running.id])
    expect(statement.object.definition.name['en-US']).toBe('Morning run')
    expect(statement.result.duration).toBe('PT28M')
    expect(measurementsFromStatement(statement)).toEqual([
      { metric: '5km_pace', kind: 'pace', unit: 'min/km', value: 330, inputs: { distance: 5, durationSeconds: 1650 } },
    ])
  })

  it('checks the card before building anything', () => {
    expect(buildCardStatement(card({ title: ' ' }), goals, actor).error).toBe('quickLog.errorTitle')
    expect(buildCardStatement(card({ skills: [] }), goals, actor).error).toBe('quickLog.errorSkill')
    expect(buildCardStatement(card({ date: '2999-01-01' }), goals, actor).error).toBe('quickLog.errorDate')
    expect(buildCardStatement(card({ durationMinutes: '2.5' }), goals, actor).error).toBe('quickLog.errorDuration')
    const bad = buildCardStatement(card({ goalValues: [{ goalId: 'goal-push', value: '3.5', distance: '', time: '' }] }), goals, actor)
    expect(bad).toMatchObject({ error: 'skillGoals.errorWholeNumber', goal: pushUpGoal })
  })
})

describe('withReflection', () => {
  it('adds the question and answer after any existing note, leaving the rest alone', () => {
    const { statement } = buildCardStatement(card({ note: 'Felt strong' }), goals, actor)
    const updated = withReflection(statement, 'What went well?', '  Kept an even pace  ')
    expect(updated.object.definition.description['en-US']).toBe('Felt strong\n\nWhat went well?\nKept an even pace')
    expect(updated.object.definition.name).toEqual(statement.object.definition.name)
    expect(updated.result).toEqual(statement.result)
    expect(updated.timestamp).toBe(statement.timestamp)
    expect(statement.object.definition.description['en-US']).toBe('Felt strong')
  })

  it('starts a note when there was none', () => {
    const { statement } = buildCardStatement(card(), goals, actor)
    expect(withReflection(statement, 'What did you learn or notice?', 'Hills are hard').object.definition.description['en-US'])
      .toBe('What did you learn or notice?\nHills are hard')
  })
})

describe('derivedGoalsForCard', () => {
  it('lists activity goals on its skills, and practice goals only with a duration', () => {
    expect(derivedGoalsForCard(card(), goals).map((goal) => goal.id)).toEqual(['goal-runs'])
    expect(derivedGoalsForCard(card({ durationMinutes: '30' }), goals).map((goal) => goal.id)).toEqual(['goal-runs', 'goal-practice'])
    expect(derivedGoalsForCard(card({ skills: [fitness] }), goals)).toEqual([])
  })
})

describe('repeatTemplates', () => {
  it('offers what the learner logs most, with values matched to their goals', () => {
    const pushUps = (value) => logged('Push-ups', [fitness], { measurements: [{ metric: 'push_ups', kind: 'count', unit: 'push-ups', value }] })
    const rows = [
      row('1', logged('Piano practice', [{ id: 'gone', name: 'Piano' }], { minutes: 30 })), // skill no longer exists
      row('2', pushUps(32)),
      row('3', logged('Evening run', [running], { minutes: 40 })),
      row('4', pushUps(28)),
      row('5', logged('Course module', [running]), { resource_id: 'res-1' }),
      row('6', { ...logged('Check-in', [running]), result: { extensions: { [DIAGNOSTIC_EXTENSION_IRI]: {} } } }),
    ]
    const templates = repeatTemplates(rows, skills, goals)
    expect(templates.map((t) => t.label)).toEqual(['Push-ups · 32 push-ups', 'Evening run · 40m'])
    expect(templates[0].card.goalValues).toEqual([{ goalId: 'goal-push', value: '32', distance: '', time: '' }])
    expect(templates[1].card).toMatchObject({ durationMinutes: '40', skills: [running], goalValues: [] })
  })

  it('makes a fresh card dated today from a template', () => {
    const [template] = repeatTemplates([row('1', logged('Evening run', [running], { minutes: 40 }))], skills, goals)
    const first = cardFromTemplate(template.card)
    const second = cardFromTemplate(template.card)
    expect(first.date).toBe(localDateString())
    expect(first.key).not.toBe(second.key)
    first.skills.push(fitness)
    expect(template.card.skills).toEqual([running])
  })

  it('turns a single activity into a card for today, or nothing when it cannot be repeated', () => {
    const statement = logged('Evening run', [running], { minutes: 40 })
    const card = cardFromRow(row('1', statement), skills, goals)
    expect(card).toMatchObject({ title: 'Evening run', durationMinutes: '40', skills: [running], date: localDateString() })
    expect(cardFromRow(row('2', statement, { resource_id: 'course' }), skills, goals)).toBeNull()
    expect(cardFromRow(row('3', logged('Piano', [{ id: 'gone', name: 'Piano' }])), skills, goals)).toBeNull()
    expect(canRepeatRow(row('4', statement))).toBe(true)
    expect(canRepeatRow(row('5', { ...statement, result: { extensions: { [DIAGNOSTIC_EXTENSION_IRI]: {} } } }))).toBe(false)
  })

  it('ignores measurements that are not for an active goal', () => {
    const statement = logged('Plank', [fitness], { measurements: [{ metric: 'plank', kind: 'duration', unit: 'seconds', value: 90 }] })
    expect(statement.result.extensions[MEASUREMENT_EXTENSION_IRI]).toHaveLength(1)
    const [template] = repeatTemplates([row('1', statement)], skills, goals)
    expect(template.card.goalValues).toEqual([])
  })
})
