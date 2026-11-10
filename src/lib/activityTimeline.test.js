import { describe, expect, it } from 'vitest'
import { activitySource, checkInLevel, combinedSetRow, dayGroups, dayLabel, foldTimeline, isCheckIn, isJustAdded, timelineRows } from './activityTimeline'
import { DIAGNOSTIC_EXTENSION_IRI, MEASUREMENT_EXTENSION_IRI, PEER_RATING_EXTENSION_IRI, PROVENANCE_EXTENSION_IRI, SKILL_EXTENSION_IRI, measurementsFromStatement } from './xapiStatement'

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

  it('counts the whole day from all rows, not just the ones shown', () => {
    const all = [row('a', 8, { minutes: 20 }), row('b', 8, { minutes: 10 }), row('c', 8, { minutes: 5 }), checkIn('d', 8), row('e', 7)]
    const groups = dayGroups(all.slice(0, 1), 'recorded_at', all)
    expect(groups.map((g) => [g.date, g.rows.length, g.activityCount, g.minutes])).toEqual([['2026-11-08', 1, 3, 35]])
  })

  it('groups by the day logged when asked', () => {
    const groups = dayGroups([row('late', 1, { created: 8 }), row('a', 7)], 'created_at')
    expect(groups.map((g) => [g.date, g.activityCount])).toEqual([['2026-11-08', 1], ['2026-11-07', 1]])
  })
})

describe('foldTimeline', () => {
  it('folds two or more check-ins in a row and leaves single ones', () => {
    const items = foldTimeline([row('a', 8), checkIn('b', 8), checkIn('c', 8), row('d', 8), checkIn('e', 8)])
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

describe('sets on the timeline', () => {
  const VERB = 'https://learnscope.app/xapi/verbs/experienced'
  const set = (id, hour, value, { name = 'Push ups', kind = 'count', unit = 'push-ups', metric = 'push_ups' } = {}) => ({
    id,
    recorded_at: at(8, hour),
    created_at: at(8, hour),
    statement: {
      verb: { id: VERB },
      object: { definition: { name: { 'en-US': name }, description: { 'en-US': `note ${id}` } } },
      result: { duration: 'PT5M', extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric, kind, unit, value }] } },
      context: { extensions: { [SKILL_EXTENSION_IRI]: [{ id: 'fit', name: 'Fitness' }] } },
    },
  })

  it('folds the same counted thing on one day into one item where the newest was', () => {
    const items = foldTimeline([set('c', 18, 18), row('run', 8), set('b', 12, 25), set('a', 8, 20)])
    expect(items.map((item) => item.type)).toEqual(['sets', 'activity'])
    expect(items[0].rows.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('leaves a single set, weigh-ins and differently named things alone', () => {
    const weigh = (id, hour) => set(id, hour, 101, { name: 'Weight', kind: 'number', unit: 'kg', metric: 'weight' })
    const items = foldTimeline([set('a', 9, 20), weigh('w1', 8), weigh('w2', 7), set('s', 6, 50, { name: 'Sit-ups', unit: 'sit-ups', metric: 'sit_ups' })])
    expect(items.map((item) => item.type)).toEqual(['activity', 'activity', 'activity', 'activity'])
  })

  it('never adds up weigh-ins, even ones saved as a whole-number count', () => {
    const weigh = (id, hour) => set(id, hour, 101, { name: 'Weight Loss', unit: 'Kg', metric: 'weight' })
    expect(foldTimeline([weigh('w1', 9), weigh('w2', 8)]).map((item) => item.type)).toEqual(['activity', 'activity'])
  })

  it('shows the sets as one row with their total, made up oldest first, and nothing of their own', () => {
    const { row: combined, parts, ordered } = combinedSetRow([set('c', 18, 18), set('b', 12, 25), set('a', 8, 20)])
    expect(parts).toEqual([20, 25, 18])
    expect(ordered.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(measurementsFromStatement(combined.statement)[0]).toMatchObject({ value: 63, unit: 'push-ups' })
    expect(combined.statement.result.duration).toBeUndefined()
    expect(combined.statement.object.definition.description).toBeUndefined()
    expect(combined.id).toBe('sets-c')
  })
})
