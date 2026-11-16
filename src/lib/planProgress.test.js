import { describe, expect, it } from 'vitest'
import { currentGoal, paceOf, planItemStatus, summariseProgress, timeElapsedPercent } from './planProgress'

const today = '2026-11-16'
const context = (extra = {}) => ({
  today,
  latestTargetBySkill: new Map(),
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

  it('measures a skill against its own target, and asks for one when there is none', () => {
    const item = { item_type: 'skill', skill_id: 's', skills: { id: 's', level: 3 } }
    expect(planItemStatus(item, context()).state).toBe('needs_target')
    expect(planItemStatus(item, context({ latestTargetBySkill: new Map([['s', { target_level: 4 }]]) })).state).toBe('in_progress')
    expect(planItemStatus(item, context({ latestTargetBySkill: new Map([['s', { target_level: 3 }]]) })).state).toBe('done')
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
