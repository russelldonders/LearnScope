import { describe, expect, it } from 'vitest'
import { dueReasonsBySkill, latestActivityBySkill, splitSkillsForList } from './skillListSections'

const today = '2026-11-22'
const skill = (id, extra = {}) => ({ id, name: id, displayedLevel: 2, next_checkin_date: null, ...extra })

describe('dueReasonsBySkill', () => {
  it('counts a check-in due today or earlier, not one still to come', () => {
    const reasons = dueReasonsBySkill({
      skills: [skill('a', { next_checkin_date: '2026-11-20' }), skill('b', { next_checkin_date: today }), skill('c', { next_checkin_date: '2026-11-30' })],
      today,
    })
    expect(reasons.get('a')).toMatchObject({ kind: 'checkin', overdue: true })
    expect(reasons.get('b')).toMatchObject({ kind: 'checkin', overdue: false })
    expect(reasons.has('c')).toBe(false)
  })

  it('counts a passed target date only while the level is below the target', () => {
    const reasons = dueReasonsBySkill({
      skills: [skill('a', { displayedLevel: 2 }), skill('b', { displayedLevel: 4 })],
      latestTargets: [
        { skill_id: 'a', target_level: 3, target_date: '2026-11-01' },
        { skill_id: 'b', target_level: 3, target_date: '2026-11-01' },
      ],
      today,
    })
    expect(reasons.get('a')).toMatchObject({ kind: 'target', overdue: true })
    expect(reasons.has('b')).toBe(false)
  })

  it('counts a goal due a log or past its date, unless reached', () => {
    const reasons = dueReasonsBySkill({
      skills: [skill('a'), skill('b'), skill('c')],
      goalItems: [
        { goal: { title: 'Run 5 km', target_date: null }, skill: { id: 'a' }, progress: { reached: false }, nextLog: today },
        { goal: { title: '50 push-ups', target_date: '2026-11-10' }, skill: { id: 'b' }, progress: { reached: false }, nextLog: null },
        { goal: { title: 'Done', target_date: '2026-11-10' }, skill: { id: 'c' }, progress: { reached: true }, nextLog: '2026-11-01' },
      ],
      today,
    })
    expect(reasons.get('a')).toMatchObject({ kind: 'goalLog', overdue: false, goalTitle: 'Run 5 km' })
    expect(reasons.get('b')).toMatchObject({ kind: 'goalDate', overdue: true, goalTitle: '50 push-ups' })
    expect(reasons.has('c')).toBe(false)
  })

  it('keeps the most pressing reason: overdue first, then the earliest', () => {
    const reasons = dueReasonsBySkill({
      skills: [skill('a', { next_checkin_date: today })],
      latestTargets: [{ skill_id: 'a', target_level: 5, target_date: '2026-11-15' }],
      goalItems: [{ goal: { title: 'G', target_date: null }, skill: { id: 'a' }, progress: {}, nextLog: '2026-11-18' }],
      today,
    })
    expect(reasons.get('a')).toMatchObject({ kind: 'target', date: '2026-11-15' })
  })

  it('ignores skills that are not in the list', () => {
    const reasons = dueReasonsBySkill({
      skills: [skill('a')],
      latestTargets: [{ skill_id: 'gone', target_level: 5, target_date: '2026-11-01' }],
      today,
    })
    expect(reasons.size).toBe(0)
  })
})

describe('latestActivityBySkill', () => {
  it('takes the newest activity per skill, through further skill links too', () => {
    const latest = latestActivityBySkill(
      [
        { id: 's1', skill_id: 'a', recorded_at: '2026-11-10T09:00:00+00:00' },
        { id: 's2', skill_id: 'a', recorded_at: '2026-11-20T09:00:00+00:00' },
        { id: 's3', skill_id: null, recorded_at: '2026-11-21T09:00:00+00:00' },
      ],
      [{ statement_id: 's3', skill_id: 'b' }, { statement_id: 's1', skill_id: 'b' }],
    )
    expect(latest.get('a')).toBe('2026-11-20T09:00:00+00:00')
    expect(latest.get('b')).toBe('2026-11-21T09:00:00+00:00')
  })
})

describe('splitSkillsForList', () => {
  it('puts each skill in one section: due, then recent, then the rest in order', () => {
    const skills = ['a', 'b', 'c', 'd', 'e'].map((id) => skill(id))
    const due = new Map([
      ['c', { date: '2026-11-21', overdue: true }],
      ['d', { date: today, overdue: false }],
      ['e', { date: '2026-11-01', overdue: true }],
    ])
    const activity = new Map([
      ['a', '2026-11-10T09:00:00+00:00'],
      ['c', '2026-11-21T09:00:00+00:00'],
      ['b', '2026-11-20T09:00:00+00:00'],
    ])
    const { due: dueList, recent, rest } = splitSkillsForList(skills, due, activity)
    expect(dueList.map((s) => s.id)).toEqual(['e', 'c', 'd'])
    expect(recent.map((s) => s.id)).toEqual(['b', 'a'])
    expect(rest.map((s) => s.id)).toEqual([])
  })
})
