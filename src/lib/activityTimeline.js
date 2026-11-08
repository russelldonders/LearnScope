// Shaping logged activities (xapi_statements rows) for the dashboard's
// day-by-day activity timeline and its rows.
import {
  DIAGNOSTIC_EXTENSION_IRI,
  PEER_RATING_EXTENSION_IRI,
  PROVENANCE_SOURCE_LABELS,
  durationMinutes,
  isDiagnosticStatement,
  isPeerRatingStatement,
  provenanceFromStatement,
} from './xapiStatement'
import { localDateString } from './skillGoalProgress'

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

// One group per local day, newest first, each with its activities (check-ins
// not counted) and their total time.
export function dayGroups(rows) {
  const groups = []
  for (const row of rows) {
    const date = localDateString(new Date(row.recorded_at))
    let group = groups.at(-1)
    if (!group || group.date !== date) {
      group = { date, rows: [], activityCount: 0, minutes: 0 }
      groups.push(group)
    }
    group.rows.push(row)
    if (!isCheckIn(row)) {
      group.activityCount += 1
      group.minutes += durationMinutes(row.statement)
    }
  }
  return groups
}

// Two or more check-ins in a row fold into one line that opens to show them.
export function foldCheckIns(rows) {
  const items = []
  for (const row of rows) {
    const last = items.at(-1)
    if (isCheckIn(row) && last?.type === 'checkIns') last.rows.push(row)
    else if (isCheckIn(row)) items.push({ type: 'checkIns', rows: [row] })
    else items.push({ type: 'activity', row })
  }
  return items.map((item) => (item.type === 'checkIns' && item.rows.length === 1 ? { type: 'checkIn', row: item.rows[0] } : item))
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
