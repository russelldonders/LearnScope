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
  goalShapeText,
  applyEntryCorrection,
  buildGoalMeasurement,
  computeGoalProgress,
  computePaceSeconds,
  dateToTimestamp,
  formatGoalValue,
  goalChartPoints,
  goalDueOn,
  goalEntryVerb,
  goalLogFeedback,
  goalMiniHistory,
  goalSessionShape,
  goalPeriodBars,
  goalReadings,
  goalStreak,
  localDateString,
  nextLogDate,
  parseClock,
  sortGoalsForAttention,
  resolveMetric,
  slugifyMetric,
  validateEntryInput,
  withTargetHistory,
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

  describe('when a goal is due', () => {
    // The week of Monday 9 to Sunday 15 November 2026.
    const at = (date, time = '15:00') => new Date(`${date}T${time}:00`)
    const dueOn = (goal, statements, now) => goalDueOn(goal, computeGoalProgress(goal, statements, now), now)
    const sets = (date, ...values) => values.map((value, i) => entry(`${date}-${i}`, date, value))
    const situps = {
      ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 900,
      per_set: 100, sets_per_session: 3, sessions_per_period: 3, log_every_days: 1,
    }

    it('leaves a goal in sets alone early in the week, whatever its rhythm', () => {
      expect(dueOn(situps, [], at('2026-11-09', '09:00'))).toBeNull()
      expect(dueOn(situps, sets('2026-11-09', 100, 100, 100), at('2026-11-12'))).toBeNull()
    })

    it('makes a goal in sets due once the sessions left fill the days left but one', () => {
      expect(dueOn(situps, sets('2026-11-09', 100, 100, 100), at('2026-11-13'))).toBe('2026-11-13')
      expect(dueOn(situps, [], at('2026-11-11'))).toBeNull()
      expect(dueOn(situps, [], at('2026-11-12'))).toBe('2026-11-12')
    })

    it('keeps a begun session due until all its sets are done', () => {
      expect(dueOn(situps, sets('2026-11-10', 100), at('2026-11-10'))).toBe('2026-11-10')
      expect(dueOn(situps, sets('2026-11-10', 100, 100), at('2026-11-10'))).toBe('2026-11-10')
      expect(dueOn(situps, sets('2026-11-10', 100, 100, 100), at('2026-11-10'))).toBeNull()
    })

    it('stops asking once the week is met', () => {
      const met = [...sets('2026-11-09', 100, 100, 100), ...sets('2026-11-10', 100, 100, 100), ...sets('2026-11-11', 100, 100, 100)]
      expect(dueOn(situps, [...met, ...sets('2026-11-14', 100)], at('2026-11-14'))).toBeNull()
    })

    it('makes a weekly total due only past half the week and behind', () => {
      const weekly = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100, log_every_days: 1 }
      expect(dueOn(weekly, [], at('2026-11-10'))).toBeNull()
      expect(dueOn(weekly, [entry('a', '2026-11-09', 40)], at('2026-11-12'))).toBe('2026-11-12')
      expect(dueOn(weekly, [entry('a', '2026-11-09', 60)], at('2026-11-12'))).toBeNull()
      expect(dueOn(weekly, [entry('a', '2026-11-09', 90)], at('2026-11-15'))).toBe('2026-11-15')
      expect(dueOn(weekly, [entry('a', '2026-11-09', 100)], at('2026-11-15'))).toBeNull()
    })

    it('counts the week from the day a goal begun mid-week started', () => {
      const weekly = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100, started_on: '2026-11-12' }
      expect(dueOn(weekly, [], at('2026-11-12'))).toBeNull()
      expect(dueOn(weekly, [], at('2026-11-15'))).toBe('2026-11-15')
      expect(dueOn(weekly, [], at('2026-11-11'))).toBeNull()
    })

    it('keeps a daily total due until its target is met', () => {
      const daily = { ...pushUpGoal, aggregation: 'total', period: 'day', target_value: 20 }
      expect(dueOn(daily, [entry('a', '2026-11-09', 10)], at('2026-11-09'))).toBe('2026-11-09')
      expect(dueOn(daily, [entry('a', '2026-11-09', 20)], at('2026-11-09'))).toBeNull()
    })

    it('follows the rhythm for any other goal', () => {
      const best = { ...pushUpGoal, log_every_days: 3 }
      expect(dueOn(best, [entry('a', '2026-11-08', 30)], at('2026-11-12'))).toBe('2026-11-11')
      expect(dueOn({ ...best, log_every_days: null }, [], at('2026-11-12'))).toBeNull()
    })
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

describe('goalPeriodBars', () => {
  const weekly = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100, started_on: '2026-10-07' }
  const now = new Date('2026-10-29T15:00:00')

  it('has one bar per week since the goal began, including empty weeks', () => {
    const bars = goalPeriodBars(weekly, [
      entry('a', '2026-10-06', 500), // before the goal began
      entry('b', '2026-10-08', 60),
      entry('c', '2026-10-11', 50),
      entry('d', '2026-10-21', 40),
      entry('e', '2026-10-27', 30),
    ], now)
    expect(bars.map((b) => [localDateString(b.start), b.value, b.status])).toEqual([
      ['2026-10-05', 110, 'met'],
      ['2026-10-12', 0, 'missed'],
      ['2026-10-19', 40, 'missed'],
      ['2026-10-26', 30, 'inProgress'],
    ])
    expect(bars.at(-1).current).toBe(true)
  })

  it('marks the current period met once the target is reached', () => {
    const bars = goalPeriodBars(weekly, [entry('a', '2026-10-27', 100)], now)
    expect(bars.at(-1).status).toBe('met')
  })

  it('has no verdict without a target', () => {
    const bars = goalPeriodBars({ ...weekly, target_value: null }, [entry('a', '2026-10-27', 10)], now)
    expect(bars.every((b) => b.status === 'none')).toBe(true)
  })

  it('keeps only the most recent periods', () => {
    const daily = { ...weekly, period: 'day', started_on: '2026-09-01' }
    const bars = goalPeriodBars(daily, [], now)
    expect(bars).toHaveLength(14)
    expect(localDateString(bars.at(-1).start)).toBe('2026-10-29')
  })

  it('handles month and year periods', () => {
    const monthly = { ...weekly, period: 'month', started_on: '2026-08-15' }
    expect(goalPeriodBars(monthly, [], now).map((b) => localDateString(b.start))).toEqual(['2026-08-01', '2026-09-01', '2026-10-01'])
    const yearly = { ...weekly, period: 'year', started_on: '2025-03-01' }
    expect(goalPeriodBars(yearly, [], now).map((b) => localDateString(b.start))).toEqual(['2025-01-01', '2026-01-01'])
  })

  it('ignores best-value goals and totals with no period', () => {
    expect(goalPeriodBars(pushUpGoal, [], now)).toEqual([])
    expect(goalPeriodBars({ ...weekly, period: null }, [], now)).toEqual([])
  })
})

describe('goalStreak', () => {
  // Weeks start Mon 5, 12, 19 and 26 October; "now" is Thu 29 October.
  const weekly = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100, started_on: '2026-10-05' }
  const now = new Date('2026-10-29T15:00:00')
  const met = (id, day) => entry(id, day, 100)

  it('counts weeks in a row that met the target, including this one once met', () => {
    expect(goalStreak(weekly, [met('a', '2026-10-06'), met('b', '2026-10-13'), met('c', '2026-10-20'), met('d', '2026-10-27')], now)).toBe(4)
  })

  it('keeps the streak while this week can still be met', () => {
    expect(goalStreak(weekly, [met('a', '2026-10-13'), met('b', '2026-10-20'), entry('c', '2026-10-27', 30)], now)).toBe(2)
  })

  it('restarts after a missed week', () => {
    expect(goalStreak(weekly, [met('a', '2026-10-06'), met('b', '2026-10-20'), met('c', '2026-10-27')], now)).toBe(2)
    expect(goalStreak(weekly, [met('a', '2026-10-13')], now)).toBe(0)
  })

  it('only applies to repeating goals with a target', () => {
    const entries = [met('a', '2026-10-20'), met('b', '2026-10-27')]
    expect(goalStreak(pushUpGoal, entries, now)).toBe(0)
    expect(goalStreak({ ...weekly, period: null }, entries, now)).toBe(0)
    expect(goalStreak({ ...weekly, target_value: null }, entries, now)).toBe(0)
  })

  it('counts beyond the periods the chart shows', () => {
    const daily = { ...weekly, period: 'day', target_value: 1, started_on: '2026-10-01' }
    const entries = Array.from({ length: 29 }, (_, i) => entry(`d${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, 1))
    expect(goalStreak(daily, entries, now)).toBe(29)
  })
})

describe('changed targets', () => {
  // Daily push-ups: target 20 until it was raised to 30 on 27 October.
  const now = new Date('2026-10-29T15:00:00')
  const first = { ...pushUpGoal, id: 'g1', aggregation: 'total', period: 'day', target_value: 20, started_on: '2026-10-20', status: 'replaced', closed_on: '2026-10-27', replaces_goal_id: null }
  const current = { ...first, id: 'g2', target_value: 30, status: 'active', closed_on: null, replaces_goal_id: 'g1' }
  const goal = withTargetHistory(current, [current, first])
  const days = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']
  const statements = days.map((day, i) => entry(`d${i}`, day, 25))

  it('lists the targets a goal replaced, oldest first', () => {
    const middle = { ...first, id: 'g1b', target_value: 25, closed_on: '2026-10-25', replaces_goal_id: 'g0' }
    const oldest = { ...first, id: 'g0', target_value: 15, closed_on: '2026-10-22' }
    const chained = withTargetHistory({ ...current, replaces_goal_id: 'g1b' }, [oldest, middle])
    expect(chained.target_history).toEqual([
      { target_value: 15, closed_on: '2026-10-22', per_set: null, sets_per_session: null, sessions_per_period: null },
      { target_value: 25, closed_on: '2026-10-25', per_set: null, sets_per_session: null, sessions_per_period: null },
    ])
    expect(withTargetHistory(first, []).target_history).toEqual([])
  })

  it('judges days before the change by the old target and after it by the new one', () => {
    const bars = goalPeriodBars(goal, statements, now).filter((bar) => localDateString(bar.start) >= '2026-10-24')
    expect(bars.map((bar) => [localDateString(bar.start), bar.target, bar.status])).toEqual([
      ['2026-10-24', 20, 'met'],
      ['2026-10-25', 20, 'met'],
      ['2026-10-26', 20, 'met'],
      ['2026-10-27', 30, 'missed'],
      ['2026-10-28', 30, 'missed'],
      ['2026-10-29', 30, 'inProgress'],
    ])
  })

  it("doesn't let a raised target break a streak already earned", () => {
    const earned = ['2026-10-25', '2026-10-26'].map((day, i) => entry(`e${i}`, day, 25))
    expect(goalStreak(withTargetHistory(current, []), earned, new Date('2026-10-27T09:00:00'))).toBe(0)
    expect(goalStreak(goal, earned, new Date('2026-10-27T09:00:00'))).toBe(2)
  })
})

describe('goalMiniHistory', () => {
  const now = new Date('2026-10-29T15:00:00')

  it('gives a repeating goal its last seven periods, each met or missed', () => {
    const daily = { ...pushUpGoal, aggregation: 'total', period: 'day', target_value: 20, started_on: '2026-10-01' }
    const history = goalMiniHistory(daily, [entry('a', '2026-10-27', 25), entry('b', '2026-10-28', 5), entry('c', '2026-10-29', 3)], now)
    expect(history.kind).toBe('periods')
    expect(history.target).toBe(20)
    expect(history.bars).toHaveLength(7)
    expect(history.bars.slice(-3).map((bar) => bar.status)).toEqual(['met', 'missed', 'inProgress'])
    expect(history.bars.at(-1).current).toBe(true)
  })

  it('has fewer bars for a goal begun recently', () => {
    const weekly = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100, started_on: '2026-10-19' }
    expect(goalMiniHistory(weekly, [], now).bars).toHaveLength(2)
  })

  it('gives any other goal its last seven entries, without judging each one', () => {
    const entries = Array.from({ length: 9 }, (_, i) => entry(`e${i}`, `2026-10-${String(i + 10)}`, 10 + i))
    const history = goalMiniHistory(pushUpGoal, entries, now)
    expect(history.kind).toBe('entries')
    expect(history.target).toBe(40)
    expect(history.bars.map((bar) => bar.value)).toEqual([12, 13, 14, 15, 16, 17, 18])
    expect(history.bars.every((bar) => bar.status === 'none')).toBe(true)
    expect(history.bars.map((bar) => bar.current)).toEqual([false, false, false, false, false, false, true])
  })

  it('shows progress instead for a total building up to one target', () => {
    const total = { ...pushUpGoal, aggregation: 'total', period: null, target_value: 1000 }
    expect(goalMiniHistory(total, [entry('a', '2026-10-20', 50)], now)).toEqual({ kind: 'progress' })
    const byYearEnd = { ...pushUpGoal, aggregation: 'total', period: 'year', target_value: 10, target_date: '2026-12-31' }
    expect(goalMiniHistory(byYearEnd, [], now).kind).toBe('progress')
  })

  it('keeps the chart for a repeating total whose deadline is periods away', () => {
    const weekly = { ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 100, target_date: '2026-12-31', started_on: '2026-10-01' }
    expect(goalMiniHistory(weekly, [], now).kind).toBe('periods')
  })

  it('leaves the target line off a running total without a target, which has no progress to show', () => {
    const total = { ...pushUpGoal, aggregation: 'total', period: null, target_value: null }
    expect(goalMiniHistory(total, [entry('a', '2026-10-20', 50)], now).target).toBeNull()
  })
})

describe('a goal corrected between whole and decimal numbers', () => {
  it('keeps entries saved as a count once the goal takes decimals, but not ones in other units', () => {
    const weight = { ...pushUpGoal, metric: 'weight', measure_kind: 'number', unit: 'kg', direction: 'lower', target_value: 96 }
    const saved = (id, kind, unit, value) => ({
      id,
      recorded_at: '2026-11-05T12:00:00',
      statement: { result: { extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric: 'weight', kind, unit, value }] } } },
    })
    const readings = goalReadings(weight, [saved('a', 'count', 'kg', 102), saved('b', 'number', 'kg', 101.4), saved('c', 'count', 'lb', 220)])
    expect(readings.map((r) => r.value)).toEqual([102, 101.4])
  })
})

describe('the verb a goal entry is logged with', () => {
  it('says practice was practised, a reading was recorded, and anything else was done', () => {
    expect(goalEntryVerb({ measure_kind: 'practice_time', aggregation: 'total' })).toBe('practiced')
    expect(goalEntryVerb({ measure_kind: 'number', aggregation: 'best', unit: 'kg' })).toBe('recorded')
    expect(goalEntryVerb({ measure_kind: 'number', aggregation: 'total', unit: 'km' })).toBe('experienced')
    for (const measure_kind of ['count', 'duration', 'pace', 'activities']) {
      expect(goalEntryVerb({ measure_kind, aggregation: 'best' })).toBe('experienced')
    }
  })
})

describe('a goal done in sets: 3 x 100, 4 times a week', () => {
  // Wednesday 11 November 2026, evening. The week began on Monday the 9th.
  const now = new Date(2026, 10, 11, 20)
  const situps = {
    ...pushUpGoal, aggregation: 'total', period: 'week', target_value: 1200, started_on: '2026-10-01',
    per_set: 100, sets_per_session: 3, sessions_per_period: 4,
  }
  const sets = (date, ...values) => values.map((value, i) => entry(`${date}-${i}`, date, value))

  it('reads the shape, and nothing without all three parts', () => {
    expect(goalSessionShape(situps)).toEqual({ perSet: 100, setsPerSession: 3, perSession: 300, sessions: 4 })
    expect(goalSessionShape({ ...situps, sessions_per_period: null })).toBeNull()
  })

  it('counts a day as a session once its sets add up to 300, however they were split', () => {
    const statements = [...sets('2026-11-09', 100, 100, 100), ...sets('2026-11-10', 150, 150), ...sets('2026-11-11', 100, 50)]
    const progress = computeGoalProgress(situps, statements, now)
    expect(progress.sessions).toMatchObject({ done: 2, sessions: 4, todayTotal: 150, todaySets: 2, perSession: 300 })
    expect(progress.reached).toBe(false)
    expect(progress.percent).toBe(50)
  })

  it('is not met by doing the whole week in one day', () => {
    const progress = computeGoalProgress(situps, sets('2026-11-09', 400, 400, 400), now)
    expect(progress.current).toBe(1200)
    expect(progress.sessions.done).toBe(1)
    expect(progress.reached).toBe(false)
  })

  it('judges each week by its sessions, so streaks follow them', () => {
    const lastWeek = ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-07'].flatMap((day) => sets(day, 100, 100, 100))
    const weekBefore = sets('2026-10-26', 900, 900)
    const bars = goalPeriodBars(situps, [...weekBefore, ...lastWeek], now).slice(-3)
    expect(bars.map((bar) => [bar.status, bar.sessions])).toEqual([['missed', 1], ['met', 4], ['inProgress', 0]])
    expect(goalStreak(situps, [...weekBefore, ...lastWeek], now)).toBe(1)
  })

  it('charts the last seven days against a session, rest days not marked as missed', () => {
    const history = goalMiniHistory(situps, [...sets('2026-11-09', 100, 100, 100), ...sets('2026-11-10', 100), ...sets('2026-11-11', 50)], now)
    expect(history).toMatchObject({ kind: 'periods', period: 'day', target: 300 })
    expect(history.bars).toHaveLength(7)
    expect(history.bars.slice(-3).map((bar) => bar.status)).toEqual(['met', 'none', 'inProgress'])
    expect(history.bars.at(-3).parts).toEqual([100, 100, 100])
  })

  it('marks a day of a daily sets goal as exceeded once it goes past the total', () => {
    const daily = { ...situps, period: 'day', target_value: 60, per_set: 20, sets_per_session: 3, sessions_per_period: 1 }
    const history = goalMiniHistory(daily, [...sets('2026-11-09', 20, 20, 20), ...sets('2026-11-10', 30, 30, 20)], now)
    expect(history.bars.slice(-3).map((bar) => [bar.status, bar.exceeded])).toEqual([
      ['met', false],
      ['met', true],
      ['inProgress', false],
    ])
  })

  it('fits several sessions into one day for a daily goal: 3 x 20, twice a day', () => {
    const twiceDaily = { ...situps, period: 'day', target_value: 120, per_set: 20, sets_per_session: 3, sessions_per_period: 2 }
    const t = (key, values) => `${key} ${JSON.stringify(values)}`

    const halfway = computeGoalProgress(twiceDaily, sets('2026-11-11', 20, 20, 20, 20), now)
    expect(halfway.sessions).toMatchObject({ done: 1, todayTarget: 120, todaySetsTarget: 6 })
    expect(halfway.reached).toBe(false)
    expect(goalShapeText(twiceDaily, halfway.sessions, t).target).toContain('targetLine.dayTimes')

    const done = computeGoalProgress(twiceDaily, sets('2026-11-11', 20, 20, 20, 20, 20, 20), now)
    expect(done.sessions.done).toBe(2)
    expect(done.reached).toBe(true)

    const bars = goalPeriodBars(twiceDaily, [...sets('2026-11-09', 20, 20, 20), ...sets('2026-11-10', 20, 20, 20, 20, 20, 20)], now).slice(-3)
    expect(bars.map((bar) => [bar.status, bar.sessions])).toEqual([['missed', 1], ['met', 2], ['inProgress', 0]])
  })

  it('still counts a weekly goal by days, so one big day is one session', () => {
    const bars = goalPeriodBars(situps, sets('2026-11-02', 300, 300, 300), now).slice(-2)
    expect(bars[0].sessions).toBe(1)
  })
})
