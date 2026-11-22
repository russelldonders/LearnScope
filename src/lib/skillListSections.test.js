import { describe, expect, it } from 'vitest'
import { dueReasonsBySkill, lastActivityLabel, latestActivityBySkill, splitSkillsForList } from './skillListSections'

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
  it('takes the newest activity per skill', () => {
    const latest = latestActivityBySkill([
      { skill_id: 'a', recorded_at: '2026-11-10T09:00:00+00:00' },
      { skill_id: 'a', recorded_at: '2026-11-20T09:00:00+00:00' },
      { skill_id: 'b', recorded_at: '2026-11-21T09:00:00+00:00' },
      { skill_id: null, recorded_at: '2026-11-22T09:00:00+00:00' },
    ])
    expect(latest.get('a')).toBe('2026-11-20T09:00:00+00:00')
    expect(latest.get('b')).toBe('2026-11-21T09:00:00+00:00')
    expect(latest.size).toBe(2)
  })
})

describe('splitSkillsForList', () => {
  const now = new Date('2026-11-22T12:00:00')

  it('puts each skill in one section: due, recent, neglected, then the rest in order', () => {
    const skills = [
      skill('due-old', { date_added: '2025-01-01' }),
      skill('recent-1'),
      skill('quiet', { date_added: '2026-11-01' }),
      skill('neglected-long', { date_added: '2025-01-01' }),
      skill('recent-2'),
      skill('neglected-never', { date_added: '2026-06-01' }),
      skill('middling'),
      skill('due-now'),
    ]
    const due = new Map([
      ['due-now', { date: today, overdue: false }],
      ['due-old', { date: '2026-11-01', overdue: true }],
    ])
    const activity = new Map([
      ['recent-1', '2026-11-10T09:00:00+00:00'],
      ['recent-2', '2026-11-20T09:00:00+00:00'],
      ['due-old', '2026-11-21T09:00:00+00:00'],
      ['neglected-long', '2026-03-01T09:00:00+00:00'],
      ['middling', '2026-10-15T09:00:00+00:00'],
    ])
    const sections = splitSkillsForList(skills, due, activity, now)
    expect(sections.due.map((s) => s.id)).toEqual(['due-old', 'due-now'])
    expect(sections.recent.map((s) => s.id)).toEqual(['recent-2', 'recent-1'])
    expect(sections.neglected.map((s) => s.id)).toEqual(['neglected-long', 'neglected-never'])
    // Added three weeks ago with no activity, or active six weeks ago: neither.
    expect(sections.rest.map((s) => s.id)).toEqual(['quiet', 'middling'])
  })
})

describe('lastActivityLabel', () => {
  const now = new Date('2026-11-22T12:00:00')
  it.each([
    ['2026-11-22T08:00:00', 'today', undefined],
    ['2026-11-21T08:00:00', 'yesterday', undefined],
    ['2026-11-12T08:00:00', 'daysAgo', 10],
    ['2026-10-25T08:00:00', 'weeksAgo', 4],
    ['2026-05-22T08:00:00', 'monthsAgo', 6],
    ['2023-11-01T08:00:00', 'yearsAgo', 3],
  ])('reads %s as %s', (date, key, count) => {
    expect(lastActivityLabel(date, now)).toEqual(count == null ? { key: `skills.sections.lastActivity.${key}` } : { key: `skills.sections.lastActivity.${key}`, count })
  })

  it('is null without an activity', () => {
    expect(lastActivityLabel(null, now)).toBeNull()
  })
})