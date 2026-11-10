import { describe, expect, it } from 'vitest'
import { buildGoalDraftRequest, normalizeGoalDraft } from './skillGoalDraft.js'

const TODAY = '2026-11-07'

const pushUps = {
  title: '40 push-ups in one set',
  metric: 'push_ups',
  measure_kind: 'count',
  unit: 'push-ups',
  direction: 'higher',
  aggregation: 'best',
  period: null,
  target_value: 40,
  target_date: '2027-03-31',
  tracker_question: 'How many push-ups did you do in your best set?',
  log_every_days: 2,
  per_set: null,
  sets_per_session: null,
  sessions_per_period: null,
}

describe('buildGoalDraftRequest', () => {
  it('requires the goal text and skill', () => {
    expect(buildGoalDraftRequest({ skillName: 'Fitness' }).error).toBeTruthy()
    expect(buildGoalDraftRequest({ text: 'Run more' }).error).toBeTruthy()
  })

  it('uses the learner date only when it is plausible', () => {
    const body = { text: 'Run more', skillName: 'Running' }
    expect(buildGoalDraftRequest({ ...body, today: '2026-11-08' }, TODAY).today).toBe('2026-11-08')
    expect(buildGoalDraftRequest({ ...body, today: '2031-01-01' }, TODAY).today).toBe(TODAY)
    expect(buildGoalDraftRequest({ ...body, today: 'soon' }, TODAY).today).toBe(TODAY)
  })

  it('writes in the learner language, defaulting to English', () => {
    const body = { text: 'Run more', skillName: 'Running' }
    expect(buildGoalDraftRequest({ ...body, language: 'nl' }, TODAY).prompt).toContain('in Dutch')
    expect(buildGoalDraftRequest({ ...body, language: 'xx' }, TODAY).prompt).toContain('in English')
  })

  it('passes on existing measures so metrics are reused', () => {
    const request = buildGoalDraftRequest({
      text: '50 push-ups',
      skillName: 'Fitness',
      existingMeasures: [
        { metric: 'push_ups', unit: 'push-ups', measure_kind: 'count' },
        { metric: 'bad', unit: 'x', measure_kind: 'nonsense' },
      ],
    }, TODAY)
    expect(request.prompt).toContain('push_ups (count, push-ups)')
    expect(request.prompt).not.toContain('nonsense')
  })
})

describe('normalizeGoalDraft', () => {
  it('passes a valid goal through', () => {
    expect(normalizeGoalDraft({ outcome: 'goal', goal: pushUps }, TODAY)).toEqual({ outcome: 'goal', goal: pushUps })
  })

  it('forces pace to a lower-is-better best result', () => {
    const { goal } = normalizeGoalDraft({
      outcome: 'goal',
      goal: { ...pushUps, measure_kind: 'pace', unit: 'minutes per km', direction: 'higher', aggregation: 'total', period: 'week', target_value: 300 },
    }, TODAY)
    expect(goal).toMatchObject({ unit: 'min/km', direction: 'lower', aggregation: 'best', period: null, target_value: 300 })
  })

  it('fixes the metric and unit of goals derived from activities', () => {
    const activities = normalizeGoalDraft({
      outcome: 'goal',
      goal: { ...pushUps, measure_kind: 'activities', metric: 'runs', unit: 'runs', aggregation: 'best', period: 'week', target_value: 3 },
    }, TODAY).goal
    expect(activities).toMatchObject({ metric: 'activity_count', unit: 'activities', aggregation: 'total', period: 'week', direction: 'higher' })

    const practice = normalizeGoalDraft({
      outcome: 'goal',
      goal: { ...pushUps, measure_kind: 'practice_time', metric: 'x', unit: 'hours', aggregation: 'total', period: 'week' },
    }, TODAY).goal
    expect(practice).toMatchObject({ metric: 'practice_minutes', unit: 'minutes' })
  })

  it('makes totals higher-is-better and drops a period from best results', () => {
    expect(normalizeGoalDraft({ outcome: 'goal', goal: { ...pushUps, aggregation: 'total', direction: 'lower', period: 'week' } }, TODAY).goal)
      .toMatchObject({ direction: 'higher', period: 'week' })
    expect(normalizeGoalDraft({ outcome: 'goal', goal: { ...pushUps, period: 'week' } }, TODAY).goal.period).toBeNull()
  })

  it('makes a "count" of kilograms, kilometres or litres a decimal number', () => {
    for (const unit of ['Kg', 'km', 'litres', 'lbs']) {
      expect(normalizeGoalDraft({ outcome: 'goal', goal: { ...pushUps, unit } }, TODAY).goal.measure_kind).toBe('number')
    }
    expect(normalizeGoalDraft({ outcome: 'goal', goal: pushUps }, TODAY).goal.measure_kind).toBe('count')
  })

  it('cleans metric names and drops values the table would reject', () => {
    const { goal } = normalizeGoalDraft({
      outcome: 'goal',
      goal: { ...pushUps, metric: 'Push-Ups!', target_value: -5, target_date: '2020-01-01', log_every_days: 900 },
    }, TODAY)
    expect(goal).toMatchObject({ metric: 'push_ups', target_value: null, target_date: null, log_every_days: null })
  })

  it('rejects impossible dates', () => {
    expect(normalizeGoalDraft({ outcome: 'goal', goal: { ...pushUps, target_date: '2027-02-31' } }, TODAY).goal.target_date).toBeNull()
  })

  it('rejects unusable goals', () => {
    expect(normalizeGoalDraft({ outcome: 'goal', goal: null }, TODAY)).toBeNull()
    expect(normalizeGoalDraft({ outcome: 'goal', goal: { ...pushUps, title: ' ' } }, TODAY)).toBeNull()
    expect(normalizeGoalDraft({ outcome: 'goal', goal: { ...pushUps, measure_kind: 'script' } }, TODAY)).toBeNull()
    expect(normalizeGoalDraft({ outcome: 'other' }, TODAY)).toBeNull()
  })

  it('keeps at most three clarifying options', () => {
    expect(normalizeGoalDraft({ outcome: 'clarify', message: 'Which?', options: ['a', 'b', 'c', 'd', ''] }, TODAY))
      .toEqual({ outcome: 'clarify', message: 'Which?', options: ['a', 'b', 'c'] })
    expect(normalizeGoalDraft({ outcome: 'clarify', message: '' }, TODAY)).toBeNull()
  })

  it('returns only the message for level targets and unsafe goals', () => {
    expect(normalizeGoalDraft({ outcome: 'unsafe', message: 'Be gentle', goal: pushUps }, TODAY)).toEqual({ outcome: 'unsafe', message: 'Be gentle' })
    expect(normalizeGoalDraft({ outcome: 'level_target', message: 'Use a level' }, TODAY)).toEqual({ outcome: 'level_target', message: 'Use a level' })
  })
})

describe('measured units', () => {
  it('uses the same list as the app', async () => {
    const { MEASURED_UNIT } = await import('./skillGoalDraft.js')
    const { MEASURED_UNIT: CLIENT_MEASURED_UNIT } = await import('../../src/lib/skillGoalProgress')
    expect(MEASURED_UNIT.source).toBe(CLIENT_MEASURED_UNIT.source)
  })
})

describe('goals done in sets', () => {
  const situps = { ...pushUps, title: '3 sets of 100 sit-ups, 4 times a week', unit: 'sit-ups', aggregation: 'total', period: 'week', target_value: 300 }

  it('keeps the shape and works the target out from it', () => {
    const { goal } = normalizeGoalDraft({ outcome: 'goal', goal: { ...situps, per_set: 100, sets_per_session: 3, sessions_per_period: 4 } }, TODAY)
    expect(goal).toMatchObject({ per_set: 100, sets_per_session: 3, sessions_per_period: 4, target_value: 1200 })
  })

  it('drops a shape that does not fit: more sessions than days, a best result, or parts missing', () => {
    const shaped = { per_set: 100, sets_per_session: 3, sessions_per_period: 4 }
    for (const goal of [
      { ...situps, ...shaped, sessions_per_period: 8 },
      { ...situps, ...shaped, aggregation: 'best', period: null },
      { ...situps, ...shaped, sets_per_session: null },
    ]) {
      expect(normalizeGoalDraft({ outcome: 'goal', goal }, TODAY).goal).toMatchObject({ per_set: null, sets_per_session: null, sessions_per_period: null })
    }
  })
})
