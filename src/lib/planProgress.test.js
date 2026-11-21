import { describe, expect, it } from 'vitest'
import { addPeriod, currentGoal, paceOf, planItemStatus, planProgressEntry, planTimeframe, sequenceLocks, summariseProgress, timeElapsedPercent } from './planProgress'

const today = '2026-11-16'
const context = (extra = {}) => ({
  today,
  goalsById: new Map(),
  replacedBy: new Map(),
  goalProgressById: new Map(),
  ...extra,
})

describe('planItemStatus', () => {
  it('reads a course from its own record', () => {
    const course = (fields) => ({ item_type: 'course', course_id: 'c', courses: { id: 'c', ...fields } })
    expect(planItemStatus(course({ status: 'planned' }), context()).state).toBe('not_started')
    expect(planItemStatus(course({ status: null }), context()).state).toBe('in_progress')
    expect(planItemStatus(course({ status: null, completed_date: '2026-11-01' }), context()).state).toBe('done')
    expect(planItemStatus(course({ status: 'cancelled' }), context()).state).toBe('stopped')
    expect(planItemStatus({ item_type: 'course', course_id: null, courses: null }, context()).state).toBe('removed')
  })

  it('measures both plan-specific skill axes without changing the learner\'s own targets', () => {
    const item = { item_type: 'skill', skill_id: 's', skills: { id: 's', level: 3, knowledge_level: 2 } }
    expect(planItemStatus(item, context()).state).toBe('needs_target')
    // Someone else's item not yet in the viewer's records: not started, not removed.
    expect(planItemStatus({ item_type: 'course', course_id: null, courses: null, needs_link: true }, context()).state).toBe('not_started')
    expect(planItemStatus({ ...item, plan_practical_level: 4 }, context()).state).toBe('in_progress')
    expect(planItemStatus({ ...item, plan_practical_level: 3 }, context()).state).toBe('done')
    expect(planItemStatus({ ...item, plan_knowledge_level: 3, plan_practical_level: 3 }, context()).state).toBe('in_progress')
    expect(planItemStatus({ ...item, plan_knowledge_level: 2, plan_practical_level: 3 }, context()).state).toBe('done')
  })

  it('follows a goal replaced by a new target to the goal in force now', () => {
    const goalsById = new Map([
      ['old', { id: 'old', status: 'replaced' }],
      ['new', { id: 'new', status: 'active' }],
    ])
    const replacedBy = new Map([['old', 'new']])
    const item = { item_type: 'skill_goal', skill_goal_id: 'old' }
    expect(planItemStatus(item, context({ goalsById, replacedBy })).state).toBe('not_started')
    expect(planItemStatus(item, context({ goalsById, replacedBy, goalProgressById: new Map([['new', { lastLogged: new Date() }]]) })).state).toBe('in_progress')
    expect(planItemStatus(item, context({ goalsById, replacedBy, goalProgressById: new Map([['new', { reached: true }]]) })).state).toBe('done')
    expect(currentGoal('old', goalsById, replacedBy).id).toBe('new')
  })

  it('counts an achieved goal as done and a stopped one as stopped', () => {
    const goalsById = new Map([['a', { id: 'a', status: 'achieved' }], ['b', { id: 'b', status: 'stopped' }]])
    expect(planItemStatus({ item_type: 'skill_goal', skill_goal_id: 'a' }, context({ goalsById })).state).toBe('done')
    expect(planItemStatus({ item_type: 'skill_goal', skill_goal_id: 'b' }, context({ goalsById })).state).toBe('stopped')
  })

  it('ticks off resources and steps on the plan', () => {
    expect(planItemStatus({ item_type: 'step', completed_on: null }, context()).state).toBe('not_started')
    expect(planItemStatus({ item_type: 'step', completed_on: '2026-11-10' }, context()).state).toBe('done')
    expect(planItemStatus({ item_type: 'skill_resource', skill_resource_id: 'r', skill_resources: { id: 'r' }, completed_on: '2026-11-10' }, context()).state).toBe('done')
  })

  it('flags an unfinished item past its date as overdue', () => {
    expect(planItemStatus({ item_type: 'step', target_on: '2026-11-01' }, context()).overdue).toBe(true)
    expect(planItemStatus({ item_type: 'step', target_on: '2026-11-01', completed_on: '2026-11-02' }, context()).overdue).toBe(false)
    expect(planItemStatus({ item_type: 'step', target_on: '2026-12-01' }, context()).overdue).toBe(false)
  })
})

describe('summariseProgress', () => {
  it('leaves stopped and removed items out of the count', () => {
    const summary = summariseProgress([
      { state: 'done' }, { state: 'in_progress', overdue: true }, { state: 'stopped' }, { state: 'removed' }, { state: 'done' },
    ])
    expect(summary).toEqual({ done: 2, total: 3, percent: 67, overdue: 1 })
    expect(summariseProgress([])).toEqual({ done: 0, total: 0, percent: 0, overdue: 0 })
  })
})

describe('timeframe', () => {
  it('says how much of the timeframe has gone', () => {
    const plan = { starts_on: '2026-11-01', target_on: '2026-12-01' }
    expect(timeElapsedPercent(plan, '2026-11-16')).toBe(50)
    expect(timeElapsedPercent(plan, '2026-10-01')).toBe(0)
    expect(timeElapsedPercent(plan, '2027-01-01')).toBe(100)
    expect(timeElapsedPercent({ starts_on: null, target_on: '2026-12-01' })).toBeNull()
  })

  it('compares progress with time gone', () => {
    expect(paceOf({ percent: 70, total: 4 }, 50)).toBe('ahead')
    expect(paceOf({ percent: 45, total: 4 }, 50)).toBe('on_track')
    expect(paceOf({ percent: 20, total: 4 }, 50)).toBe('behind')
    expect(paceOf({ percent: 0, total: 0 }, 50)).toBeNull()
    expect(paceOf({ percent: 20, total: 4 }, null)).toBeNull()
  })
})

describe('sequenceLocks', () => {
  const statuses = new Map([['a', { state: 'done' }], ['b', { state: 'not_started' }], ['c', { state: 'not_started' }], ['d', { state: 'removed' }], ['e', { state: 'not_started' }]])
  const lists = [[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'd' }, { id: 'e' }]]

  it('locks nothing in a plan done in any order', () => {
    expect(sequenceLocks('none', lists, statuses).size).toBe(0)
  })

  it('locks everything after the first unfinished item, across the plan', () => {
    expect([...sequenceLocks('plan', lists, statuses)]).toEqual(['c', 'd', 'e'])
  })

  it('locks within each section on its own, and never on a removed item', () => {
    expect([...sequenceLocks('sections', lists, statuses)]).toEqual(['c'])
  })
})

describe('plan timeframes', () => {
  it('adds days, weeks and months, keeping a month-end in its month', () => {
    expect(addPeriod('2026-11-16', 30, 'days')).toBe('2026-12-16')
    expect(addPeriod('2026-11-16', 2, 'weeks')).toBe('2026-11-30')
    expect(addPeriod('2026-11-16', 6, 'months')).toBe('2027-05-16')
    expect(addPeriod('2027-01-31', 1, 'months')).toBe('2027-02-28')
  })

  it('keeps a fixed timeframe as it is', () => {
    expect(planTimeframe({ starts_on: '2026-11-01', target_on: '2027-01-01' })).toEqual({ startsOn: '2026-11-01', targetOn: '2027-01-01', period: null })
  })

  it('counts a period from the later of the plan starting and the viewer joining', () => {
    const plan = { status: 'active', starts_on: '2026-11-01', duration_amount: 30, duration_unit: 'days' }
    expect(planTimeframe({ ...plan, my_joined_on: '2026-10-20' })).toEqual({ startsOn: '2026-11-01', targetOn: '2026-12-01', period: { amount: 30, unit: 'days' } })
    expect(planTimeframe({ ...plan, my_joined_on: '2026-11-10' }).targetOn).toBe('2026-12-10')
    expect(planTimeframe({ ...plan, status: 'planning' }).targetOn).toBeNull()
    expect(timeElapsedPercent({ ...plan, my_joined_on: '2026-11-10' }, '2026-11-25')).toBe(50)
  })
})

describe('planProgressEntry', () => {
  const items = [
    { id: 'a', item_type: 'step', completed_on: '2026-11-01' },
    { id: 'b', item_type: 'step', completed_on: null },
  ]
  it('records counts only for a personal plan', () => {
    expect(planProgressEntry({ id: 'p', organisation_id: null, items }, { today: '2026-11-21' })).toEqual({ planId: 'p', done: 1, total: 2 })
  })
  it('adds each step’s status on an organisation plan', () => {
    expect(planProgressEntry({ id: 'p', organisation_id: 'org-1', items }, { today: '2026-11-21' })).toEqual({
      planId: 'p', done: 1, total: 2,
      items: [{ item_id: 'a', status: 'done' }, { item_id: 'b', status: 'not_started' }],
    })
  })
})
