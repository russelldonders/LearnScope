import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTIC_EXTENSION_IRI,
  MEASUREMENT_EXTENSION_IRI,
  PEER_RATING_EXTENSION_IRI,
  buildStatement,
  formatMeasurements,
  measurementsFromStatement,
} from './xapiStatement'
import {
  applyEntryCorrection,
  buildGoalMeasurement,
  computeGoalProgress,
  computePaceSeconds,
  dateToTimestamp,
  formatGoalValue,
  goalChartPoints,
  goalLogFeedback,
  goalReadings,
  localDateString,
  nextLogDate,
  parseClock,
  sortGoalsForAttention,
  resolveMetric,
  slugifyMetric,
  validateEntryInput,
} from './skillGoalProgress'

const pushUpGoal = {
  metric: 'push_ups',
  measure_kind: 'count',
  unit: 'push-ups',
  direction: 'higher',
  aggregation: 'best',
  period: null,
  target_value: 40,
  started_on: '2026-10-01',
}
const paceGoal = {
  metric: '5km_pace',
  measure_kind: 'pace',
  unit: 'min/km',
  direction: 'lower',
  aggregation: 'best',
  period: null,
  target_value: 300,
  started_on: '2026-10-01',
}

function entry(id, date, value, metric = 'push_ups') {
  const [kind, unit] = metric === '5km_pace' ? ['pace', 'min/km'] : ['count', 'push-ups']
  return {
    id,
    recorded_at: `${date}T12:00:00`,
    statement: { result: { extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric, kind, unit, value }] } } },
  }
}

describe('goalReadings', () => {
  it('reads only the goal metric, oldest first, whatever order they were logged in', () => {
    const readings = goalReadings(pushUpGoal, [
      entry('b', '2026-10-05', 30),
      entry('other', '2026-10-04', 99, 'squats'),
      entry('a', '2026-10-02', 25),
    ])
    expect(readings.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('does not pick up old entries under the same name in other units', () => {
    const lbGoal = { ...pushUpGoal, metric: 'bench', measure_kind: 'number', unit: 'lb' }
    const kgEntry = {
      id: 'kg',
      recorded_at: '2026-10-02T12:00:00',
      statement: { result: { extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric: 'bench', kind: 'number', unit: 'kg', value: 100 }] } } },
    }
    expect(goalReadings(lbGoal, [kgEntry])).toEqual([])
  })

  it('counts learner activities but not diagnostics or peer ratings', () => {
    const goal = { ...pushUpGoal, measure_kind: 'activities', aggregation: 'total' }
    const readings = goalReadings(goal, [
      { id: 'run', recorded_at: '2026-10-02T12:00:00', statement: {} },
      { id: 'quiz', recorded_at: '2026-10-02T12:00:00', statement: { result: { extensions: { [DIAGNOSTIC_EXTENSION_IRI]: {} } } } },
      { id: 'rating', recorded_at: '2026-10-02T12:00:00', statement: { result: { extensions: { [PEER_RATING_EXTENSION_IRI]: {} } } } },
    ])
    expect(readings.map((r) => r.id)).toEqual(['run'])
  })

  it('adds up logged time for practice goals and skips activities without any', () => {
    const goal = { ...pushUpGoal, measure_kind: 'practice_time', aggregation: 'total' }
    const readings = goalReadings(goal, [
      { id: 'a', recorded_at: '2026-10-02T12:00:00', statement: { result: { duration: 'PT1H30M' } } },
      { id: 'b', recorded_at: '2026-10-03T12:00:00', statement: {} },
    ])
    expect(readings).toHaveLength(1)
    expect(readings[0].value).toBe(90)
  })
})

describe('computeGoalProgress', () => {
  it('uses the best value since the goal began', () => {
    const progress = computeGoalProgress(pushUpGoal, [
      entry('a', '2026-10-02', 20),
      entry('b', '2026-10-05', 30),
      entry('c', '2026-10-08', 25),
    ])
    expect(progress).toMatchObject({ current: 30, baseline: 20, reached: false, entryCount: 3 })
    expect(progress.percent).toBe(50)
  })

  it('does not let values from before the goal complete it, but starts from them', () => {
    const progress = computeGoalProgress(pushUpGoal, [
      entry('old', '2019-01-01', 50),
      entry('now', '2026-10-05', 30),
    ])
    expect(progress.current).toBe(30)
    expect(progress.baseline).toBe(50)
    expect(progress.reached).toBe(false)
  })

  it('counts a backdated entry on the day the goal began', () => {
    expect(computeGoalProgress(pushUpGoal, [entry('a', '2026-10-01', 40)]).reached).toBe(true)
  })

  it('treats lower as better for pace', () => {
    const statements = [entry('a', '2026-10-02', 360, '5km_pace'), entry('b', '2026-10-05', 330, '5km_pace')]
    const progress = computeGoalProgress(paceGoal, statements)
    expect(progress.current).toBe(330)
    expect(progress.percent).toBe(50)
    expect(computeGoalProgress(paceGoal, [...statements, entry('c', '2026-10-09', 299, '5km_pace')]).reached).toBe(true)
  })

  it('totals the current week from Monday', () => {
    const goal = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100 }
    // 11 Nov 2026 is a Wednesday, so that week began on Monday 9 Nov.
    const progress = computeGoalProgress(
      goal,
      [entry('sun', '2026-11-08', 50), entry('mon', '2026-11-09', 30), entry('wed', '2026-11-11', 25)],
      new Date('2026-11-11T18:00:00'),
    )
    expect(progress.current).toBe(55)
    expect(progress.percent).toBeCloseTo(55)
    expect(progress.reached).toBe(false)
  })

  it('does not count entries from earlier in the period than the goal began', () => {
    const goal = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100, started_on: '2026-11-11' }
    const progress = computeGoalProgress(
      goal,
      [entry('mon', '2026-11-09', 100), entry('wed', '2026-11-11', 25)],
      new Date('2026-11-12T18:00:00'),
    )
    expect(progress.current).toBe(25)
    expect(progress.reached).toBe(false)
  })

  it('totals everything since the start when there is no period', () => {
    const goal = { ...pushUpGoal, aggregation: 'total', target_value: 50 }
    const progress = computeGoalProgress(goal, [entry('before', '2026-09-01', 99), entry('a', '2026-10-02', 20), entry('b', '2026-10-03', 30)])
    expect(progress.current).toBe(50)
    expect(progress.reached).toBe(true)
  })

  it('tracks without a target', () => {
    const progress = computeGoalProgress({ ...pushUpGoal, target_value: null }, [entry('a', '2026-10-02', 20)])
    expect(progress).toMatchObject({ current: 20, target: null, percent: null, reached: false })
  })

  it('handles a goal with no entries', () => {
    expect(computeGoalProgress(pushUpGoal, [])).toMatchObject({ current: null, percent: null, reached: false, lastLogged: null })
  })

  it('does not show a full bar when an old value was already past the target', () => {
    const progress = computeGoalProgress(pushUpGoal, [
      entry('old', '2026-09-01', 99),
      entry('a', '2026-10-02', 25),
      entry('b', '2026-10-05', 32),
    ])
    expect(progress.reached).toBe(false)
    expect(Math.round(progress.percent)).toBe(47)
  })

  it('shows no movement rather than negative progress', () => {
    const progress = computeGoalProgress(pushUpGoal, [entry('old', '2026-09-01', 30), entry('now', '2026-10-05', 20)])
    expect(progress.percent).toBe(0)
  })
})

describe('goalChartPoints', () => {
  it('plots each entry for a best-value goal, including earlier history', () => {
    expect(goalChartPoints(pushUpGoal, [entry('old', '2026-09-01', 10), entry('a', '2026-10-02', 20)]).map((p) => p.value)).toEqual([10, 20])
  })

  it('plots one point per period', () => {
    const goal = { ...pushUpGoal, aggregation: 'total', period: 'month' }
    expect(goalChartPoints(goal, [entry('a', '2026-10-02', 20), entry('b', '2026-10-30', 5), entry('c', '2026-11-02', 7)]).map((p) => p.value)).toEqual([25, 7])
  })

  it('plots a running total when there is no period', () => {
    const goal = { ...pushUpGoal, aggregation: 'total' }
    expect(goalChartPoints(goal, [entry('a', '2026-10-02', 20), entry('b', '2026-10-03', 5)]).map((p) => p.value)).toEqual([20, 25])
  })
})

describe('time and pace', () => {
  it('parses times', () => {
    expect(parseClock('25:30')).toBe(1530)
    expect(parseClock('1:05:00')).toBe(3900)
    expect(parseClock(' 5:00 ')).toBe(300)
  })

  it('rejects what is not a time', () => {
    expect(parseClock('')).toBeNull()
    expect(parseClock('fast')).toBeNull()
    expect(parseClock('45')).toBeNull()
    expect(parseClock('5:75')).toBeNull()
    expect(parseClock('1:2:3:4')).toBeNull()
  })

  it('calculates pace from distance and time', () => {
    expect(computePaceSeconds(5, 1500)).toBe(300)
    expect(computePaceSeconds(0, 1500)).toBeNull()
    expect(computePaceSeconds(5, 0)).toBeNull()
  })

  it('formats values in the goal terms', () => {
    expect(formatGoalValue(pushUpGoal, 32)).toBe('32 push-ups')
    expect(formatGoalValue(paceGoal, 300)).toBe('5:00 min/km')
    expect(formatGoalValue({ measure_kind: 'duration', unit: 'seconds' }, 3900)).toBe('1:05:00')
    expect(formatGoalValue(pushUpGoal, null)).toBe('')
  })
})

describe('metric names', () => {
  it('builds a safe name, falling back when there are no Latin letters', () => {
    expect(slugifyMetric('Push-Ups in one set!')).toBe('push_ups_in_one_set')
    expect(slugifyMetric('俯卧撑')).toMatch(/^measure_[a-z0-9]+$/)
  })

  it('keeps a shared metric only when its values mean the same thing', () => {
    const existing = [{ metric: 'weight', measure_kind: 'number', unit: 'kg', aggregation: 'best' }]
    expect(resolveMetric('weight', 'number', 'kg', 'best', existing)).toBe('weight')
    expect(resolveMetric('weight', 'number', 'lb', 'best', existing)).toBe('weight_2')
    expect(resolveMetric('weight', 'number', 'kg', 'total', existing)).toBe('weight_2')
    expect(resolveMetric('new', 'count', 'reps', 'best', existing)).toBe('new')
  })
})

describe('entries', () => {
  it('validates what the measure needs', () => {
    expect(validateEntryInput(pushUpGoal, { value: '32' })).toBeNull()
    expect(validateEntryInput(pushUpGoal, { value: '' })).toBe('skillGoals.errorWholeNumber')
    expect(validateEntryInput(pushUpGoal, { value: '3.5' })).toBe('skillGoals.errorWholeNumber')
    expect(validateEntryInput(pushUpGoal, { value: '-1' })).toBe('skillGoals.errorWholeNumber')
    expect(validateEntryInput({ measure_kind: 'number' }, { value: '3.5' })).toBeNull()
    expect(validateEntryInput(paceGoal, { distance: '', durationSeconds: 100 })).toBe('skillGoals.errorDistance')
    expect(validateEntryInput(paceGoal, { distance: '5', durationSeconds: null })).toBe('skillGoals.errorTime')
    expect(validateEntryInput(paceGoal, { distance: '5', durationSeconds: 1500 })).toBeNull()
    expect(validateEntryInput({ measure_kind: 'activities' }, {})).toBeNull()
  })

  it('keeps the distance and time a pace came from', () => {
    expect(buildGoalMeasurement(paceGoal, { distance: '5', durationSeconds: 1500 })).toEqual({
      metric: '5km_pace',
      kind: 'pace',
      unit: 'min/km',
      value: 300,
      inputs: { distance: 5, durationSeconds: 1500 },
    })
  })

  it('stores values on the statement in a form that reads back', () => {
    const statement = buildStatement({
      actor: { name: 'A', email: 'a@example.com' },
      verbValue: 'practiced',
      activityName: 'Push-ups',
      timestamp: '2026-10-02T12:00:00Z',
      relatedSkills: [{ id: 's1', name: 'Fitness' }],
      durationHours: 0,
      durationMinutes: 25,
      measurements: [buildGoalMeasurement(pushUpGoal, { value: '32' })],
    })
    expect(statement.result.duration).toBe('PT25M')
    expect(measurementsFromStatement(statement)[0].value).toBe(32)
    expect(formatMeasurements(statement)).toBe('32 push-ups')
  })

  it('leaves ordinary activities unchanged', () => {
    const statement = buildStatement({
      actor: { name: 'A' },
      verbValue: 'practiced',
      activityName: 'Run',
      timestamp: '2026-10-02T12:00:00Z',
    })
    expect(statement.result).toBeUndefined()
    expect(measurementsFromStatement(statement)).toEqual([])
    expect(formatMeasurements(statement)).toBe('')
  })

  it('corrects an entry without disturbing the rest of the statement', () => {
    const original = buildStatement({
      actor: { name: 'A' },
      verbValue: 'practiced',
      activityName: 'Pace',
      description: 'Windy',
      timestamp: '2026-10-02T12:00:00Z',
      relatedSkills: [{ id: 's1', name: 'Running' }],
      measurements: [
        buildGoalMeasurement(paceGoal, { distance: '5', durationSeconds: 1500 }),
        { metric: 'other', kind: 'count', unit: 'x', value: 1 },
      ],
    })
    const corrected = applyEntryCorrection(original, paceGoal, {
      input: { distance: '5', durationSeconds: 1440 },
      timestamp: '2026-10-03T12:00:00.000Z',
      note: '',
    })
    expect(corrected.id).toBe(original.id)
    expect(corrected.context).toEqual(original.context)
    expect(corrected.timestamp).toBe('2026-10-03T12:00:00.000Z')
    expect(corrected.result.duration).toBe('PT24M')
    expect(corrected.object.definition.description).toBeUndefined()
    expect(corrected.object.definition.name).toEqual({ 'en-US': 'Pace' })
    const measurements = measurementsFromStatement(corrected)
    expect(measurements.find((m) => m.metric === '5km_pace').value).toBe(288)
    expect(measurements.find((m) => m.metric === 'other').value).toBe(1)
    expect(measurements).toHaveLength(2)
    const trail = measurements.find((m) => m.metric === '5km_pace').corrections
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({ value: 300, timestamp: original.timestamp })

    const again = applyEntryCorrection(corrected, paceGoal, {
      input: { distance: '5', durationSeconds: 1400 },
      timestamp: corrected.timestamp,
      note: '',
    })
    expect(measurementsFromStatement(again).find((m) => m.metric === '5km_pace').corrections.map((c) => c.value)).toEqual([300, 288])
  })

  it('ignores malformed measurements rather than breaking activity lists', () => {
    const statement = {
      result: {
        extensions: {
          [MEASUREMENT_EXTENSION_IRI]: [null, 'x', { metric: 'a' }, { metric: 'b', unit: 'u', value: 'NaN' }, { metric: 'c', kind: 'count', unit: 'reps', value: 3 }],
        },
      },
    }
    expect(measurementsFromStatement(statement).map((m) => m.metric)).toEqual(['c'])
    expect(formatMeasurements(statement)).toBe('3 reps')
    expect(measurementsFromStatement({ result: { extensions: { [MEASUREMENT_EXTENSION_IRI]: 'nope' } } })).toEqual([])
  })
})

describe('dates', () => {
  it('keeps a picked date on that calendar day', () => {
    expect(localDateString(new Date(dateToTimestamp('2026-03-01')))).toBe('2026-03-01')
  })
})

describe('logging rhythm and attention', () => {
  const rhythmGoal = { ...pushUpGoal, log_every_days: 3 }

  it('counts the next log from the goal start when nothing was logged since', () => {
    expect(nextLogDate(rhythmGoal, null)).toBe('2026-10-04')
    expect(nextLogDate(rhythmGoal, new Date('2026-09-20T12:00:00'))).toBe('2026-10-04')
  })

  it('counts the next log from the last entry', () => {
    expect(nextLogDate(rhythmGoal, new Date('2026-10-10T12:00:00'))).toBe('2026-10-13')
  })

  it('has no next log without a rhythm', () => {
    expect(nextLogDate({ ...pushUpGoal, log_every_days: null }, null)).toBeNull()
  })

  it('celebrates a target just reached, then a new best', () => {
    expect(goalLogFeedback(pushUpGoal, { reached: false, current: 30 }, { reached: true, current: 41 })).toBe(
      'skillGoals.dashboard.reachedNow',
    )
    expect(goalLogFeedback(pushUpGoal, { reached: false, current: 30 }, { reached: false, current: 32 })).toBe(
      'skillGoals.dashboard.newBest',
    )
    expect(goalLogFeedback(paceGoal, { reached: false, current: 330 }, { reached: false, current: 320 })).toBe(
      'skillGoals.dashboard.newBest',
    )
  })

  it('says nothing special for a first entry, an equal value or a total', () => {
    expect(goalLogFeedback(pushUpGoal, { reached: false, current: null }, { reached: false, current: 20 })).toBeNull()
    expect(goalLogFeedback(pushUpGoal, { reached: false, current: 30 }, { reached: false, current: 30 })).toBeNull()
    const totalGoal = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100 }
    expect(goalLogFeedback(totalGoal, { reached: false, current: 30 }, { reached: false, current: 50 })).toBeNull()
  })

  it('puts goals due a log first, then the nearest target date, then the newest', () => {
    const item = (id, extra = {}, nextLog = null) => ({
      goal: { id, target_date: null, created_at: '2026-10-01T00:00:00Z', ...extra },
      nextLog,
    })
    const sorted = sortGoalsForAttention(
      [
        item('new', { created_at: '2026-10-05T00:00:00Z' }),
        item('target-late', { target_date: '2027-03-01' }),
        item('due-later', {}, '2026-11-08'),
        item('not-due-yet', { target_date: '2027-01-01' }, '2026-11-10'),
        item('due-first', {}, '2026-11-01'),
        item('old'),
      ],
      '2026-11-08',
    )
    expect(sorted.map((i) => i.goal.id)).toEqual(['due-first', 'due-later', 'not-due-yet', 'target-late', 'new', 'old'])
  })
})
