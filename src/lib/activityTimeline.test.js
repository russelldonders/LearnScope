import { describe, expect, it } from 'vitest'
import { activitySource, checkInLevel, dayGroups, dayLabel, foldCheckIns, isCheckIn, isJustAdded, timelineRows } from './activityTimeline'
import { DIAGNOSTIC_EXTENSION_IRI, PEER_RATING_EXTENSION_IRI, PROVENANCE_EXTENSION_IRI } from './xapiStatement'

// Sunday 8 November 2026, midday local time.
const NOW = new Date(2026, 10, 8, 12).getTime()
const at = (day, hour = 9) => new Date(2026, 10, day, hour).toISOString()

function row(id, recordedDay, { created = recordedDay, minutes, statement = {} } = {}) {
  return {
    id,
    recorded_at: at(recordedDay),
    created_at: at(created, 10),
    statement: {
      object: { definition: { name: { 'en-US': id } } },
      ...(minutes ? { result: { duration: `PT${minutes}M` } } : {}),
      ...statement,
    },
  }
}
const checkIn = (id, day, level = 3) => row(id, day, { statement: { result: { extensions: { [DIAGNOSTIC_EXTENSION_IRI]: { confirmedLevel: level } } } } })

describe('timelineRows', () => {
  it('orders by when activities happened and keeps a just-added backdated one', () => {
    const rows = [
      row('old-just-added', 1, { created: 8 }),
      row('a', 8), row('b', 7), row('c', 6), row('d', 5),
      row('old', 2),
    ]
    expect(timelineRows(rows, { limit: 3, now: NOW }).map((r) => r.id)).toEqual(['a', 'b', 'c', 'old-just-added'])
  })
})

describe('isJustAdded', () => {
  it('is only for recent hand-logged entries for another day', () => {
    expect(isJustAdded(row('x', 1, { created: 8 }), NOW)).toBe(true)
    expect(isJustAdded(row('x', 8), NOW)).toBe(false)
    expect(isJustAdded(row('x', 1, { created: 3 }), NOW)).toBe(false)
    const imported = row('x', 1, { created: 8, statement: { context: { extensions: { [PROVENANCE_EXTENSION_IRI]: { source: 'strava' } } } } })
    expect(isJustAdded(imported, NOW)).toBe(false)
  })

  it('adds at most three just-added entries beyond the limit', () => {
    const rows = [row('a', 8), ...[1, 2, 3, 4, 5].map((day) => row(`late-${day}`, day, { created: 8 }))]
    expect(timelineRows(rows, { limit: 1, now: NOW })).toHaveLength(4)
  })
})

describe('dayGroups', () => {
  it('groups by day with activity counts and time, leaving check-ins out of the totals', () => {
    const groups = dayGroups([row('a', 8, { minutes: 20 }), row('b', 8, { minutes: 10 }), checkIn('c', 8), row('d', 7)])
    expect(groups.map((g) => [g.date, g.activityCount, g.minutes])).toEqual([['2026-11-08', 2, 30], ['2026-11-07', 1, 0]])
  })
})

describe('foldCheckIns', () => {
  it('folds two or more check-ins in a row and leaves single ones', () => {
    const items = foldCheckIns([row('a', 8), checkIn('b', 8), checkIn('c', 8), row('d', 8), checkIn('e', 8)])
    expect(items.map((item) => item.type)).toEqual(['activity', 'checkIns', 'activity', 'checkIn'])
    expect(items[1].rows.map((r) => r.id)).toEqual(['b', 'c'])
  })
})

describe('check-ins', () => {
  it('recognises diagnostics and ratings and reads their level', () => {
    const rating = row('r', 8, { statement: { result: { extensions: { [PEER_RATING_EXTENSION_IRI]: { level: 4 } } } } })
    expect(isCheckIn(checkIn('c', 8))).toBe(true)
    expect(isCheckIn(rating)).toBe(true)
    expect(isCheckIn(row('a', 8))).toBe(false)
    expect(checkInLevel(checkIn('c', 8, 2))).toBe(2)
    expect(checkInLevel(rating)).toBe(4)
  })
})

describe('activitySource', () => {
  const strava = (description) => ({
    object: { definition: { description: { 'en-US': description } } },
    context: { extensions: { [PROVENANCE_EXTENSION_IRI]: { source: 'strava', externalId: '1' } } },
  })

  it('turns the Strava sync line into a source and a distance, keeping any later note', () => {
    expect(activitySource(strava('Synced from Strava · 3.8 km'))).toEqual({ source: 'Strava', note: null, distance: '3.8 km' })
    expect(activitySource(strava('Synced from Strava · 3.8 km\n\nWhat went well?\nPacing'))).toEqual({
      source: 'Strava', note: 'What went well?\nPacing', distance: '3.8 km',
    })
  })

  it('leaves a hand-written note alone', () => {
    expect(activitySource({ object: { definition: { description: { 'en-US': 'Felt strong' } } } })).toEqual({ source: null, note: 'Felt strong', distance: null })
  })
})

describe('dayLabel', () => {
  const t = (key) => ({ 'activity.timeline.today': 'Today', 'activity.timeline.yesterday': 'Yesterday' }[key])
  it('says today, yesterday, the weekday, then the date', () => {
    expect(dayLabel('2026-11-08', { now: NOW, language: 'en-GB', t })).toBe('Today')
    expect(dayLabel('2026-11-07', { now: NOW, language: 'en-GB', t })).toBe('Yesterday')
    expect(dayLabel('2026-11-04', { now: NOW, language: 'en-GB', t })).toBe('Wednesday')
    expect(dayLabel('2026-10-20', { now: NOW, language: 'en-GB', t })).toBe('20 Oct')
    expect(dayLabel('2025-10-20', { now: NOW, language: 'en-GB', t })).toBe('20 Oct 2025')
  })
})
