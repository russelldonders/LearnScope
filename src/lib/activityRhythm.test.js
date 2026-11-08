import { describe, expect, it } from 'vitest'
import { activeDays, activityRhythm } from './activityRhythm'
import { PEER_RATING_EXTENSION_IRI } from './xapiStatement'

// 2026-11-08 is a Sunday; that week started on Monday 2026-11-02.
const TODAY = '2026-11-08'
const days = (...dates) => new Set(dates)

describe('activeDays', () => {
  it('collects local days and ignores ratings from other people', () => {
    const result = activeDays([
      { recorded_at: '2026-11-08T09:00:00', extensions: null },
      { recorded_at: '2026-11-08T18:00:00', extensions: {} },
      { recorded_at: '2026-11-06T12:00:00', extensions: { [PEER_RATING_EXTENSION_IRI]: { rating: 3 } } },
      { recorded_at: null },
    ])
    expect([...result]).toEqual(['2026-11-08'])
  })
})

describe('activityRhythm', () => {
  it('shows the last seven days ending today', () => {
    const rhythm = activityRhythm(days('2026-11-02', '2026-11-08', '2026-10-30'), TODAY)
    expect(rhythm.lastSeven.map((day) => day.date)).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ])
    expect(rhythm.lastSeven.map((day) => day.logged)).toEqual([true, false, false, false, false, false, true])
    expect(rhythm.lastSeven[6].isToday).toBe(true)
    expect(rhythm.daysInLastSeven).toBe(2)
  })

  it('counts weeks in a row with something logged, including this week', () => {
    // This week (Mon 2 Nov), the week of 26 Oct, the week of 19 Oct; nothing the week of 12 Oct.
    const rhythm = activityRhythm(days('2026-11-04', '2026-10-26', '2026-10-25', '2026-10-20', '2026-10-05'), TODAY)
    expect(rhythm.loggedThisWeek).toBe(true)
    expect(rhythm.weekStreak).toBe(3)
  })

  it('keeps last week’s streak alive while this week is still empty', () => {
    const rhythm = activityRhythm(days('2026-11-01', '2026-10-27'), TODAY)
    expect(rhythm.loggedThisWeek).toBe(false)
    expect(rhythm.weekStreak).toBe(1)
  })

  it('has no streak when neither this week nor last week has anything', () => {
    expect(activityRhythm(days('2026-10-20'), TODAY).weekStreak).toBe(0)
    expect(activityRhythm(days(), TODAY).weekStreak).toBe(0)
  })

  it('counts days in a row up to today, or up to yesterday if today is empty', () => {
    expect(activityRhythm(days('2026-11-08', '2026-11-07', '2026-11-06', '2026-11-04'), TODAY)).toMatchObject({
      loggedToday: true,
      dayStreak: 3,
    })
    expect(activityRhythm(days('2026-11-07', '2026-11-06'), TODAY)).toMatchObject({ loggedToday: false, dayStreak: 2 })
    expect(activityRhythm(days('2026-11-05'), TODAY).dayStreak).toBe(0)
  })

  it('crosses month and year boundaries', () => {
    const rhythm = activityRhythm(days('2027-01-01', '2026-12-31', '2026-12-28', '2026-12-24'), '2027-01-01')
    expect(rhythm.dayStreak).toBe(2)
    // Fri 1 Jan 2027 is in the week of Mon 28 Dec; 24 Dec is the week before.
    expect(rhythm.weekStreak).toBe(2)
  })
})
