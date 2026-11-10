// Editing and deleting an activity the learner logged themselves. Records the
// app or another service wrote -- course records, synced imports, ratings and
// knowledge check-ins -- aren't edited here (the database refuses most of
// that too; see guard_xapi_statement_writes).
import { supabase } from './supabaseClient'
import { XAPI_VERBS, XAPI_VERB_BY_IRI } from './xapiVerbs'
import {
  MEASUREMENT_EXTENSION_IRI,
  activityName,
  buildDuration,
  durationMinutes,
  measurementsFromStatement,
  provenanceFromStatement,
} from './xapiStatement'
import { isCheckIn } from './activityTimeline'
import { dateToTimestamp, localDateString } from './skillGoalProgress'

// Counted values (sit-ups, kg) can be changed here. Times and paces are
// edited from their goal's entries, where the form knows how to read them.
const EDITABLE_VALUE_KINDS = new Set(['count', 'number'])

export function canEditActivity(row) {
  return row.resource_id == null && !isCheckIn(row) && !provenanceFromStatement(row.statement)
}

// The form's starting values, all as text.
export function activityEditFields(row) {
  const statement = row.statement
  const minutes = durationMinutes(statement)
  return {
    title: activityName(statement),
    verb: XAPI_VERB_BY_IRI[statement.verb?.id]?.value ?? 'experienced',
    date: localDateString(new Date(row.recorded_at)),
    hours: minutes >= 60 ? String(Math.floor(minutes / 60)) : '',
    minutes: minutes % 60 ? String(minutes % 60) : '',
    note: statement.object?.definition?.description?.['en-US'] ?? '',
    values: measurementsFromStatement(statement)
      .map((m, index) => ({ index, metric: m.metric, kind: m.kind, unit: m.unit, value: String(m.value) }))
      .filter((m) => EDITABLE_VALUE_KINDS.has(m.kind)),
  }
}

function wholeOrEmpty(text) {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 0 ? value : null
}

// The activity with the learner's changes, or { error } with a translation
// key. A changed value keeps what it said before, as a goal entry correction
// does, so an edit can't quietly rewrite history. Same day keeps the original
// time, so the order of the day's entries doesn't change.
export function applyActivityEdit(row, fields, today = localDateString()) {
  const title = fields.title.trim()
  if (!title) return { error: 'activity.edit.errorTitle' }
  if (!fields.date || fields.date > today) return { error: 'activity.edit.errorDate' }
  const hours = wholeOrEmpty(fields.hours)
  const minutes = wholeOrEmpty(fields.minutes)
  if (hours === null || minutes === null || minutes > 59) return { error: 'activity.edit.errorDuration' }
  const verb = XAPI_VERBS.find((v) => v.value === fields.verb)
  if (!verb) return { error: 'activity.edit.errorType' }

  const statement = row.statement
  const sameDay = localDateString(new Date(row.recorded_at)) === fields.date
  const timestamp = sameDay ? new Date(row.recorded_at).toISOString() : dateToTimestamp(fields.date)

  const measurements = measurementsFromStatement(statement).map((m) => ({ ...m }))
  for (const edit of fields.values) {
    const measurement = measurements[edit.index]
    if (!measurement) continue
    const value = Number(edit.value.trim().replace(',', '.'))
    const valid = edit.value.trim() !== '' && Number.isFinite(value) && value >= 0
      && (measurement.kind !== 'count' || Number.isInteger(value))
    if (!valid) return { error: measurement.kind === 'count' ? 'skillGoals.errorWholeNumber' : 'skillGoals.errorNumber' }
    if (value !== Number(measurement.value)) {
      measurement.corrections = [
        ...(measurement.corrections ?? []),
        { value: measurement.value, timestamp: statement.timestamp, corrected_at: new Date().toISOString() },
      ]
      measurement.value = value
    }
  }

  const result = { ...statement.result }
  const duration = buildDuration(hours, minutes)
  if (duration) result.duration = duration
  else delete result.duration
  if (measurements.length > 0) {
    result.extensions = { ...result.extensions, [MEASUREMENT_EXTENSION_IRI]: measurements }
  }

  const definition = { ...statement.object?.definition, name: { 'en-US': title } }
  const note = fields.note.trim()
  if (note) definition.description = { 'en-US': note }
  else delete definition.description

  const updated = {
    ...statement,
    verb: { id: verb.iri, display: { 'en-US': verb.label } },
    timestamp,
    object: { ...statement.object, definition },
  }
  if (Object.keys(result).length > 0) updated.result = result
  else delete updated.result
  return { statement: updated, recordedAt: timestamp }
}

export async function updateActivity(row, statement, recordedAt) {
  const { data, error } = await supabase
    .from('xapi_statements')
    .update({ statement, recorded_at: recordedAt })
    .eq('id', row.id)
    .select('id')
  if (error) throw error
  // RLS turns someone else's row into "0 rows changed" rather than an error.
  if (!data?.length) throw new Error("This activity couldn't be changed from this account.")
}

// Permanently removes the activity and any evidence files attached to it. Its
// links to skills go with it; the skills, goals and roles themselves stay.
export async function deleteActivity(row) {
  const { data, error } = await supabase.from('xapi_statements').delete().eq('id', row.id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error("This activity couldn't be deleted from this account.")
  const paths = row.evidence_paths ?? []
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('skill-evidence').remove(paths)
    if (storageError) {
      console.error('Could not remove evidence files for a deleted activity:', storageError)
      throw new Error("The activity was deleted, but its attached files couldn't be removed.")
    }
  }
}
