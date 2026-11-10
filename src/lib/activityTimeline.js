// Shaping logged activities (xapi_statements rows) for the dashboard's
// day-by-day activity timeline and its rows.
import {
  DIAGNOSTIC_EXTENSION_IRI,
  MEASUREMENT_EXTENSION_IRI,
  PEER_RATING_EXTENSION_IRI,
  PROVENANCE_SOURCE_LABELS,
  activityName,
  durationMinutes,
  isDiagnosticStatement,
  isPeerRatingStatement,
  measurementsFromStatement,
  provenanceFromStatement,
  relatedSkillsFromStatement,
} from './xapiStatement'
import { isMeasuredUnit, localDateString } from './skillGoalProgress'

const DAY_MS = 24 * 60 * 60 * 1000
const JUST_ADDED_MS = 2 * DAY_MS

// Entries the app generated rather than something the learner did: knowledge
// check-ins and ratings from connections.
export function isCheckIn(row) {
  return isDiagnosticStatement(row.statement) || isPeerRatingStatement(row.statement)
}

// The level a check-in or rating landed on, for its ring.
export function checkInLevel(row) {
  const result = row.statement?.result?.extensions ?? {}
  const level = result[DIAGNOSTIC_EXTENSION_IRI]?.confirmedLevel
    ?? result[DIAGNOSTIC_EXTENSION_IRI]?.calibratedLevel
    ?? result[PEER_RATING_EXTENSION_IRI]?.level
  return Number.isInteger(level) && level >= 1 && level <= 5 ? level : null
}

// Where an imported activity came from ("Strava"), and its note with the
// "Synced from Strava · 3.8 km" line taken apart: the distance becomes a
// figure and the source a badge, so neither repeats in the note.
export function activitySource(statement) {
  const provenance = provenanceFromStatement(statement)
  const source = provenance ? PROVENANCE_SOURCE_LABELS[provenance.source] ?? provenance.source : null
  const note = statement.object?.definition?.description?.['en-US']?.trim() || null
  if (!source || !note) return { source, note, distance: null }
  const match = new RegExp(`^Synced from ${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: · ([^\\n]+))?(?:\\n+([\\s\\S]*))?$`).exec(note)
  if (!match) return { source, note, distance: null }
  return { source, note: match[2]?.trim() || null, distance: match[1]?.trim() || null }
}

// Logged by hand in the last two days for a different day than it happened:
// worth pointing out, since it sorts into its real day rather than at the top.
// Imports (e.g. a Strava sync) are left out -- a sync brings in many past
// activities at once and they'd all count.
export function isJustAdded(row, now = Date.now()) {
  if (!row.created_at || !row.recorded_at || provenanceFromStatement(row.statement)) return false
  const created = new Date(row.created_at)
  if (now - created.getTime() > JUST_ADDED_MS) return false
  return localDateString(created) !== localDateString(new Date(row.recorded_at))
}

const MAX_JUST_ADDED = 3

// The most recent `limit` activities by when they happened, plus up to three
// logged by hand in the last two days for an earlier date, so a backdated
// entry still shows up straight after it's added. Newest first.
export function timelineRows(rows, { limit = 8, now = Date.now() } = {}) {
  const byHappened = [...rows].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
  const shown = byHappened.slice(0, limit)
  const extra = byHappened
    .slice(limit)
    .filter((row) => isJustAdded(row, now))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, MAX_JUST_ADDED)
  const extraIds = new Set(extra.map((row) => row.id))
  return [...shown, ...byHappened.slice(limit).filter((row) => extraIds.has(row.id))]
}

// The browser's own regional variant when it matches the app's language (so
// British English gets "19 Oct"), otherwise the app's language.
export function displayLocale(language) {
  const browser = typeof navigator !== 'undefined' ? navigator.language : ''
  return browser?.toLowerCase().startsWith(language?.toLowerCase() ?? '') ? browser : language
}

// Activities (check-ins not counted) and total minutes per local day.
function dayTotals(rows, field) {
  const totals = new Map()
  for (const row of rows) {
    if (isCheckIn(row)) continue
    const date = localDateString(new Date(row[field]))
    const total = totals.get(date) ?? { activityCount: 0, minutes: 0 }
    total.activityCount += 1
    total.minutes += durationMinutes(row.statement)
    totals.set(date, total)
  }
  return totals
}

// One group per local day, in the order the rows arrive. Grouped by when each
// activity happened, or by when it was logged (field 'created_at') for a
// "recently logged" view. Each day's activity count and time come from
// allRows -- everything on that day, not just the rows being shown -- so a
// day with more activities than fit on screen still says how much was done.
export function dayGroups(rows, field = 'recorded_at', allRows = rows) {
  const totals = dayTotals(allRows, field)
  const groups = []
  for (const row of rows) {
    const date = localDateString(new Date(row[field]))
    let group = groups.at(-1)
    if (!group || group.date !== date) {
      group = { date, rows: [], activityCount: 0, minutes: 0, ...totals.get(date) }
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

// What makes entries sets of the same thing: one counted value (reps, not a
// weight, a distance or a time), under the same name, verb and
// skills. Null for anything else.
export function setKey(row) {
  if (isCheckIn(row)) return null
  const measurements = measurementsFromStatement(row.statement)
  if (measurements.length !== 1 || measurements[0].kind !== 'count') return null
  const [measurement] = measurements
  // Weigh-ins saved as a whole-number count (kg) still mustn't be added up.
  if (isMeasuredUnit(measurement.unit)) return null
  const skills = relatedSkillsFromStatement(row.statement).map((skill) => skill.id).sort().join(',')
  return [activityName(row.statement).trim().toLowerCase(), row.statement.verb?.id, measurement.metric, measurement.unit, skills].join('|')
}

// One day's rows for the timeline, newest first. Two or more sets of the same
// thing that day fold into one item where the newest of them was, wherever
// the others fell; two or more check-ins in a row fold into one line.
export function foldTimeline(rows) {
  const sets = new Map()
  for (const row of rows) {
    const key = setKey(row)
    if (key) sets.set(key, [...(sets.get(key) ?? []), row])
  }
  const items = []
  const placed = new Set()
  for (const row of rows) {
    const key = setKey(row)
    if (key && sets.get(key).length > 1) {
      if (!placed.has(key)) items.push({ type: 'sets', rows: sets.get(key) })
      placed.add(key)
      continue
    }
    const last = items.at(-1)
    if (isCheckIn(row) && last?.type === 'checkIns') last.rows.push(row)
    else if (isCheckIn(row)) items.push({ type: 'checkIns', rows: [row] })
    else items.push({ type: 'activity', row })
  }
  return items.map((item) => (item.type === 'checkIns' && item.rows.length === 1 ? { type: 'checkIn', row: item.rows[0] } : item))
}

// The sets, oldest first, as one row to show: the newest set's skills and
// verb, with the sets' total as its value and no note, time or evidence of its
// own (those stay on each set). parts: each set's value, oldest first.
export function combinedSetRow(rows) {
  const ordered = [...rows].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
  const parts = ordered.map((row) => Number(measurementsFromStatement(row.statement)[0].value))
  const newest = ordered.at(-1)
  const [measurement] = measurementsFromStatement(newest.statement)
  const { duration: _duration, ...result } = newest.statement.result ?? {}
  const definition = { ...newest.statement.object?.definition, description: undefined }
  const statement = {
    ...newest.statement,
    object: { ...newest.statement.object, definition },
    result: {
      ...result,
      extensions: { ...result.extensions, [MEASUREMENT_EXTENSION_IRI]: [{ ...measurement, value: parts.reduce((sum, part) => sum + part, 0) }] },
    },
  }
  return { row: { ...newest, id: `sets-${newest.id}`, evidence_paths: [], evidence_url: null, statement }, parts, ordered }
}

// "today", "yesterday", the weekday within the last week, otherwise the date.
export function dayLabel(date, { now = Date.now(), language = 'en', t }) {
  const today = localDateString(new Date(now))
  const yesterday = localDateString(new Date(now - DAY_MS))
  if (date === today) return t('activity.timeline.today')
  if (date === yesterday) return t('activity.timeline.yesterday')
  const day = new Date(`${date}T12:00:00`)
  if (now - day.getTime() < 6 * DAY_MS) return new Intl.DateTimeFormat(language, { weekday: 'long' }).format(day)
  const sameYear = day.getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(day)
}
