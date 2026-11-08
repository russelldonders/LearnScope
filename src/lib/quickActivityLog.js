import { supabase } from './supabaseClient'
import { XAPI_VERB_BY_IRI } from './xapiVerbs'
import {
  activityName,
  buildStatement,
  durationMinutes,
  formatClock,
  formatMeasurements,
  formatMinutes,
  isDiagnosticStatement,
  isPeerRatingStatement,
  measurementsFromStatement,
  provenanceFromStatement,
  relatedSkillsFromStatement,
} from './xapiStatement'
import {
  buildGoalMeasurement,
  dateToTimestamp,
  isDerivedKind,
  localDateString,
  parseClock,
  validateEntryInput,
} from './skillGoalProgress'

// The dashboard's "What did you do?" box: a sentence turned into draft
// activities by AI, or a past activity repeated, shown as editable cards and
// saved only once the learner confirms. Everything here is plain data in and
// out; saving goes through the same saveActivity path as every other activity.

let nextKey = 0
const newKey = () => `draft-${(nextKey += 1)}`

// Asks AI to read the sentence. Skills and goals are sent as plain lists and
// come back as positions in them, so it can only point at what the learner has.
export async function draftActivitiesFromText({ text, skills, goals, language }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')

  const skillIndex = new Map(skills.map((skill, index) => [skill.id, index]))
  const res = await fetch('/api/suggest-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({
      operation: 'log-activity',
      text,
      language,
      today: localDateString(),
      skills: skills.map((skill) => ({ name: skill.name })),
      goals: goals.map((goal) => ({
        title: goal.title,
        skill: skillIndex.get(goal.skill_id) ?? null,
        measure_kind: goal.measure_kind,
        unit: goal.unit,
        aggregation: goal.aggregation,
        tracker_question: goal.tracker_question,
      })),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Failed to read this.')
  return body
}

// The editable form of a goal value: what the learner would type.
function goalFields(goal, { value = null, distance = null, seconds = null }) {
  return {
    value: value != null && (goal.measure_kind === 'count' || goal.measure_kind === 'number') ? String(value) : '',
    distance: distance != null ? String(distance) : '',
    time: seconds != null ? formatClock(seconds) : '',
  }
}

// Turns the AI's answer into cards, matching positions back to real skills
// and goals.
export function cardsFromDraft(draft, skills, goals) {
  return (draft.activities ?? []).map((activity) => ({
    key: newKey(),
    title: activity.title,
    date: activity.date,
    durationMinutes: activity.duration_minutes != null ? String(activity.duration_minutes) : '',
    verb: activity.verb,
    skills: activity.skills.map((index) => skills[index]).filter(Boolean),
    newSkill: activity.new_skill,
    goalValues: activity.goal_values
      .map((entry) => {
        const goal = goals[entry.goal]
        return goal ? { goalId: goal.id, ...goalFields(goal, entry) } : null
      })
      .filter(Boolean),
    note: activity.note ?? '',
  }))
}

function isRepeatable(row) {
  const statement = row.statement
  return (
    row.resource_id == null &&
    !isDiagnosticStatement(statement) &&
    !isPeerRatingStatement(statement) &&
    !provenanceFromStatement(statement)
  )
}

function measuredGoalFor(goals, measurement) {
  return goals.find(
    (goal) =>
      !isDerivedKind(goal.measure_kind) &&
      goal.metric === measurement.metric &&
      goal.unit === measurement.unit &&
      goal.measure_kind === measurement.kind,
  )
}

// One logged activity as a template card: its title, verb, duration, skills
// and the values it recorded for active goals. Null for anything that can't
// be repeated, or whose skills have all been removed.
function templateFromRow(row, skillsById, goals) {
  if (!isRepeatable(row)) return null
  const statement = row.statement
  const relatedSkills = relatedSkillsFromStatement(statement)
    .map((skill) => skillsById.get(skill.id))
    .filter(Boolean)
  if (relatedSkills.length === 0) return null
  const title = activityName(statement)
  const measurements = measurementsFromStatement(statement)
  const minutes = durationMinutes(statement)
  return {
    key: [
      title.toLowerCase(),
      relatedSkills.map((skill) => skill.id).sort().join(','),
      measurements.map((m) => m.metric).sort().join(','),
    ].join('|'),
    label: [title, formatMeasurements(statement) || formatMinutes(minutes)].filter(Boolean).join(' · '),
    card: {
      title,
      verb: XAPI_VERB_BY_IRI[statement.verb?.id]?.value ?? 'experienced',
      durationMinutes: minutes ? String(minutes) : '',
      skills: relatedSkills,
      newSkill: null,
      goalValues: measurements
        .map((m) => {
          const goal = measuredGoalFor(goals, m)
          if (!goal) return null
          const seconds = m.kind === 'pace' ? m.inputs?.durationSeconds : m.kind === 'duration' ? m.value : null
          return { goalId: goal.id, ...goalFields(goal, { value: m.value, distance: m.inputs?.distance, seconds }) }
        })
        .filter(Boolean),
      note: '',
    },
  }
}

// One activity ready to log again today, or null when it can't be repeated
// (course records, imports, check-ins, ratings, or no remaining skills).
export function cardFromRow(row, skills, goals) {
  const template = templateFromRow(row, new Map(skills.map((skill) => [skill.id, skill])), goals)
  return template ? cardFromTemplate(template.card) : null
}

// Whether "Log again" makes sense for this activity, before skills are known.
export function canRepeatRow(row) {
  return isRepeatable(row) && relatedSkillsFromStatement(row.statement).length > 0
}

// Up to `limit` things the learner logs often, most frequent first, as cards
// ready to save again today. Built from activities they logged themselves --
// not course records, imports, check-ins or ratings -- on skills they still
// have.
export function repeatTemplates(rows, skills, goals, limit = 4) {
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]))
  const groups = new Map()
  for (const row of rows) {
    const template = templateFromRow(row, skillsById, goals)
    if (!template) continue
    const group = groups.get(template.key)
    if (group) {
      group.count += 1
      continue
    }
    groups.set(template.key, { count: 1, order: groups.size, label: template.label, card: template.card })
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, limit)
    .map(({ label, card }) => ({ label, card }))
}

// A fresh copy of a template, dated today.
export function cardFromTemplate(template) {
  return {
    ...template,
    key: newKey(),
    date: localDateString(),
    skills: [...template.skills],
    goalValues: template.goalValues.map((entry) => ({ ...entry })),
  }
}

// The goal input a card's typed fields stand for.
export function goalInput(entry) {
  return {
    value: entry.value.trim(),
    distance: entry.distance.trim(),
    durationSeconds: parseClock(entry.time),
  }
}

// Goals this card counts towards without a value: "activities" goals on its
// skills, and practice-time goals when it has a duration.
export function derivedGoalsForCard(card, goals) {
  const skillIds = new Set(card.skills.map((skill) => skill.id))
  return goals.filter(
    (goal) =>
      skillIds.has(goal.skill_id) &&
      (goal.measure_kind === 'activities' || (goal.measure_kind === 'practice_time' && Number(card.durationMinutes) > 0)),
  )
}

// A date picked in the form means that day; an entry for today keeps the
// actual time so it sorts correctly and counts straight away.
function cardTimestamp(date) {
  return date === localDateString() ? new Date().toISOString() : dateToTimestamp(date)
}

// The questions offered after saving. One is picked each time so it doesn't
// feel like a form; the answer is optional.
export const REFLECTION_PROMPTS = ['quickLog.reflect.wentWell', 'quickLog.reflect.nextTime', 'quickLog.reflect.noticed']

// The statement with a reflection added to the end of its note, question
// first so it still reads clearly later. Everything else stays as it was.
export function withReflection(statement, question, answer) {
  const definition = { ...statement.object?.definition }
  const existing = definition.description?.['en-US']?.trim()
  const reflection = `${question}\n${answer.trim()}`
  definition.description = { 'en-US': existing ? `${existing}\n\n${reflection}` : reflection }
  return { ...statement, object: { ...statement.object, definition } }
}

export async function saveReflection(row, question, answer) {
  const statement = withReflection(row.statement, question, answer)
  const { data, error } = await supabase
    .from('xapi_statements')
    .update({ statement })
    .eq('id', row.id)
    .select('id, statement')
  if (error) throw error
  // RLS turns someone else's row into "0 rows changed" rather than an error.
  if (!data?.length) throw new Error("This activity couldn't be changed from this account.")
  return data[0]
}

// Checks a card and builds the statement to save. Returns { error } with a
// translation key, or { statement, skillIds }.
export function buildCardStatement(card, goals, actor) {
  const title = card.title.trim()
  if (!title) return { error: 'quickLog.errorTitle' }
  if (!card.date || card.date > localDateString()) return { error: 'quickLog.errorDate' }
  if (card.skills.length === 0) return { error: 'quickLog.errorSkill' }
  const minutes = card.durationMinutes.trim() === '' ? 0 : Number(card.durationMinutes)
  if (!Number.isInteger(minutes) || minutes < 0) return { error: 'quickLog.errorDuration' }

  const measurements = []
  for (const entry of card.goalValues) {
    const goal = goals.find((other) => other.id === entry.goalId)
    if (!goal) continue
    const input = goalInput(entry)
    const problem = validateEntryInput(goal, input)
    if (problem) return { error: problem, goal }
    measurements.push(buildGoalMeasurement(goal, input))
  }

  const statement = buildStatement({
    actor,
    verbValue: card.verb,
    activityName: title,
    description: card.note.trim() || null,
    timestamp: cardTimestamp(card.date),
    relatedSkills: card.skills.map((skill) => ({ id: skill.id, name: skill.name })),
    durationHours: Math.floor(minutes / 60),
    durationMinutes: minutes % 60,
    measurements,
  })
  return { statement, skillIds: card.skills.map((skill) => skill.id) }
}
