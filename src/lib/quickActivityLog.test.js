import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const { buildCardStatement, canRepeatRow, currentExperiences, cardFromRow, cardFromTemplate, cardsFromDraft, derivedGoalsForCard, repeatTemplates, withReflection } = await import('./quickActivityLog')
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
    const { statements: [statement], skillIds } = buildCardStatement(
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
    const { statements: [statement] } = buildCardStatement(card({ note: 'Felt strong' }), goals, actor)
    const updated = withReflection(statement, 'What went well?', '  Kept an even pace  ')
    expect(updated.object.definition.description['en-US']).toBe('Felt strong\n\nWhat went well?\nKept an even pace')
    expect(updated.object.definition.name).toEqual(statement.object.definition.name)
    expect(updated.result).toEqual(statement.result)
    expect(updated.timestamp).toBe(statement.timestamp)
    expect(statement.object.definition.description['en-US']).toBe('Felt strong')
  })

  it('starts a note when there was none', () => {
    const { statements: [statement] } = buildCardStatement(card(), goals, actor)
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

describe('current roles and projects', () => {
  const job = { id: 'job', type: 'employment', title: 'Product Manager', organization: 'Acme', start_date: '2024-01-01', end_date: null, parent_experience_id: null }
  const pastJob = { id: 'old', type: 'employment', title: 'Analyst', start_date: '2020-01-01', end_date: '2023-12-31', parent_experience_id: null }
  const project = { id: 'proj', type: 'project', title: 'Website relaunch', start_date: '2024-02-01', end_date: null, parent_experience_id: 'job' }
  const degree = { id: 'deg', type: 'education', title: 'BSc', start_date: '2015-09-01', end_date: null, parent_experience_id: null }

  it('keeps ongoing jobs, volunteer roles and projects, with their parent', () => {
    const result = currentExperiences([job, pastJob, project, degree], '2026-11-09')
    expect(result.map((e) => e.id)).toEqual(['job', 'proj'])
    expect(result[1].parent).toEqual({ id: 'job', title: 'Product Manager', type: 'employment' })
  })

  it('maps the AI choice onto a card, and leaves it empty when none was chosen', () => {
    const experiences = currentExperiences([job, project], '2026-11-09')
    const draft = {
      activities: [
        { title: 'Roadmap review', date: localDateString(), duration_minutes: null, verb: 'experienced', skills: [0], new_skill: null, goal_values: [], note: null, experience: 1 },
        { title: 'Run', date: localDateString(), duration_minutes: null, verb: 'practiced', skills: [1], new_skill: null, goal_values: [], note: null, experience: null },
      ],
    }
    const [first, second] = cardsFromDraft(draft, skills, goals, experiences)
    expect(first.experienceId).toBe('proj')
    expect(second.experienceId).toBeNull()
  })

  it('records the chosen role or project on the statement, with its trail', () => {
    const experiences = currentExperiences([job, project], '2026-11-09')
    const built = buildCardStatement(card({ skills: [fitness], experienceId: 'proj' }), goals, actor, experiences)
    expect(built.experienceId).toBe('proj')
    const context = Object.values(built.statements[0].context.extensions).find((value) => value?.id === 'proj')
    expect(context).toMatchObject({ title: 'Website relaunch', type: 'project', parent: { id: 'job', title: 'Product Manager' } })
  })

  it('refuses a date outside the role or project', () => {
    const later = { ...project, start_date: '2999-01-01' }
    const built = buildCardStatement(card({ skills: [fitness], experienceId: 'proj' }), goals, actor, [later])
    expect(built.error).toBe('quickLog.errorExperienceDate')
  })
})

describe('several sets in one card', () => {
  const dailyPushUps = { id: 'goal-daily', skill_id: fitness.id, title: 'Push-ups per day', metric: 'push_ups_day', measure_kind: 'count', unit: 'push-ups', aggregation: 'total' }
  const withDaily = [...goals, dailyPushUps]

  it('keeps the drafted sets after the first as extra sets on the card', () => {
    const [first] = cardsFromDraft({
      activities: [{ title: 'Push-ups', date: localDateString(), duration_minutes: null, verb: 'experienced', skills: [0], new_skill: null, goal_values: [{ goal: 4, value: 20, sets: [20, 25, 18] }], note: null }],
    }, skills, withDaily)
    expect(first.goalValues).toEqual([expect.objectContaining({ goalId: 'goal-daily', value: '20', extraSets: ['25', '18'] })])
  })

  it('saves one activity per set, each with only its own value, the note and time on the first', () => {
    const built = buildCardStatement(card({
      title: 'Push-ups', skills: [fitness], durationMinutes: '10', note: 'Felt strong',
      goalValues: [{ goalId: 'goal-daily', value: '20', distance: '', time: '', extraSets: ['25', '18'] }],
    }), withDaily, actor)
    expect(built.statements).toHaveLength(3)
    expect(built.statements.map((s) => measurementsFromStatement(s)[0].value)).toEqual([20, 25, 18])
    expect(built.statements[0].result.duration).toBe('PT10M')
    expect(built.statements[0].object.definition.description['en-US']).toBe('Felt strong')
    expect(built.statements[1].result.duration).toBeUndefined()
    expect(built.statements[1].object.definition.description).toBeUndefined()
    expect(built.statements[2].object.definition.name['en-US']).toBe('Push-ups')
  })

  it('checks every set, and ignores extra sets on a goal that keeps the best', () => {
    const bad = buildCardStatement(card({ skills: [fitness], goalValues: [{ goalId: 'goal-daily', value: '20', distance: '', time: '', extraSets: ['2.5'] }] }), withDaily, actor)
    expect(bad.error).toBe('skillGoals.errorWholeNumber')
    const best = buildCardStatement(card({ skills: [fitness], goalValues: [{ goalId: 'goal-push', value: '20', distance: '', time: '', extraSets: ['25'] }] }), withDaily, actor)
    expect(best.statements).toHaveLength(1)
  })
})

describe('which goals take sets', () => {
  it('is reps and other counted totals, not distances, weights or best results', async () => {
    const { goalTakesSets } = await import('./quickActivityLog')
    expect(goalTakesSets({ aggregation: 'total', measure_kind: 'count', unit: 'push-ups' })).toBe(true)
    expect(goalTakesSets({ aggregation: 'total', measure_kind: 'number', unit: 'km' })).toBe(false)
    expect(goalTakesSets({ aggregation: 'total', measure_kind: 'count', unit: 'Kg' })).toBe(false)
    expect(goalTakesSets({ aggregation: 'best', measure_kind: 'count', unit: 'push-ups' })).toBe(false)
  })
})

describe('the verb of a quick-log card', () => {
  const draftWith = (goalValues, verb = 'practiced') => cardsFromDraft({
    activities: [{ title: 'Sit-ups', date: localDateString(), duration_minutes: null, verb, skills: [0], new_skill: null, goal_values: goalValues, note: null }],
  }, skills, [...goals, { id: 'goal-weight', skill_id: fitness.id, title: 'Weight', metric: 'weight', measure_kind: 'number', unit: 'kg', aggregation: 'best' }])[0].verb

  it('follows the goal it gives a value for, as when logging from the goal', () => {
    expect(draftWith([{ goal: 1, value: 20 }])).toBe('experienced')
    expect(draftWith([{ goal: 4, value: 101.5 }])).toBe('recorded')
  })

  it('keeps the drafted verb when no goal is involved', () => {
    expect(draftWith([], 'completed')).toBe('completed')
  })
})

describe('logging again', () => {
  it('uses the goal\'s verb for a value towards a goal, whatever the original was saved with', () => {
    const daily = { id: 'goal-daily', skill_id: fitness.id, title: 'Push-ups per day', metric: 'push_ups', measure_kind: 'count', unit: 'push-ups', aggregation: 'total' }
    const statement = logged('Push-ups', [fitness], { measurements: [{ metric: 'push_ups', kind: 'count', unit: 'push-ups', value: 20 }] })
    expect(statement.verb.id).toBe('https://learnscope.app/xapi/verbs/practiced')
    const card = cardFromRow(row('1', statement), skills, [daily])
    expect(card.verb).toBe('experienced')
    expect(card.goalValues).toEqual([expect.objectContaining({ goalId: 'goal-daily', value: '20' })])
  })

  it('keeps the original verb when no goal is involved', () => {
    expect(cardFromRow(row('2', logged('Morning run', [running])), skills, goals).verb).toBe('practiced')
  })
})
