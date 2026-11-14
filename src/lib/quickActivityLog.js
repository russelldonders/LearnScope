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
  goalEntryVerb,
  isMeasuredUnit,
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

const PART_OF_TYPES = ['employment', 'volunteer', 'project']

// The learner's current roles and projects -- the jobs, volunteer roles and
// projects still going on (no end date, or one not yet passed) -- each with
// its parent (the job a project sits under) for the experience trail, from
// their whole Experience list.
export function currentExperiences(rows, today = localDateString()) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return rows
    .filter((row) => PART_OF_TYPES.includes(row.type) && (!row.end_date || row.end_date >= today))
    .map((row) => {
      const parent = row.parent_experience_id ? byId.get(row.parent_experience_id) : null
      return { ...row, parent: parent ? { id: parent.id, title: parent.title, type: parent.type } : null }
    })
}

// Asks AI to read the sentence. Skills, goals and current roles/projects are
// sent as plain lists and come back as positions in them, so it can only
// point at what the learner has.
export async function draftActivitiesFromText({ text, skills, goals, experiences = [], language }) {
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
      experiences: experiences.map((experience) => ({
        title: experience.title,
        organization: experience.organization,
        kind: experience.type === 'project' ? 'project' : 'role',
        within: experience.parent?.title ?? null,
        start_date: experience.start_date,
        end_date: experience.end_date,
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

// Turns the AI's answer into cards, matching positions back to real skills,
// goals and current roles/projects.
export function cardsFromDraft(draft, skills, goals, experiences = []) {
  return (draft.activities ?? []).map((activity) => ({
    key: newKey(),
    title: activity.title,
    date: activity.date,
    durationMinutes: activity.duration_minutes != null ? String(activity.duration_minutes) : '',
    // A value for a goal reads the same as logging it from the goal: sit-ups
    // were done, a weigh-in recorded. The learner can still change it.
    verb: goals[activity.goal_values?.[0]?.goal] ? goalEntryVerb(goals[activity.goal_values[0].goal]) : activity.verb,
    skills: activity.skills.map((index) => skills[index]).filter(Boolean),
    newSkill: activity.new_skill,
    goalValues: activity.goal_values
      .map((entry) => {
        const goal = goals[entry.goal]
        // A second and later set ("3 sets of 20") becomes its own activity on
        // save; the first set is the card's own value.
        return goal ? { goalId: goal.id, ...goalFields(goal, entry), extraSets: (entry.sets ?? []).slice(1).map(String) } : null
      })
      .filter(Boolean),
    note: activity.note ?? '',
    experienceId: experiences[activity.experience]?.id ?? null,
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
  const goalValues = measurements
    .map((m) => {
      const goal = measuredGoalFor(goals, m)
      if (!goal) return null
      const seconds = m.kind === 'pace' ? m.inputs?.durationSeconds : m.kind === 'duration' ? m.value : null
      return { goalId: goal.id, ...goalFields(goal, { value: m.value, distance: m.inputs?.distance, seconds }) }
    })
    .filter(Boolean)
  const firstGoal = goalValues.length ? goals.find((goal) => goal.id === goalValues[0].goalId) : null
  return {
    key: [
      title.toLowerCase(),
      relatedSkills.map((skill) => skill.id).sort().join(','),
      measurements.map((m) => m.metric).sort().join(','),
    ].join('|'),
    label: [title, formatMeasurements(statement) || formatMinutes(minutes)].filter(Boolean).join(' · '),
    card: {
      title,
      // Repeating a value for a goal reads the same as logging it from the
      // goal, even when the original was saved with another verb.
      verb: firstGoal ? goalEntryVerb(firstGoal) : XAPI_VERB_BY_IRI[statement.verb?.id]?.value ?? 'experienced',
      durationMinutes: minutes ? String(minutes) : '',
      skills: relatedSkills,
      newSkill: null,
      goalValues,
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

// Logging from a skill's own page: whatever was said, it's about that skill,
// so every card includes it (first), and it stands in for a new skill the
// draft would otherwise have suggested when nothing else matched. The learner
// can still add or remove skills on the card.
export function withFocusSkill(cards, skill) {
  if (!skill) return cards
  return cards.map((card) => {
    if (card.skills.some((s) => s.id === skill.id)) return card
    return { ...card, skills: [skill, ...card.skills], newSkill: card.skills.length === 0 ? null : card.newSkill }
  })
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

// Whether a card's value for this goal can be split into sets: reps or other
// things counted one by one that add up each entry -- not distances or weights.
export function goalTakesSets(goal) {
  return goal.aggregation === 'total' && goal.measure_kind === 'count' && !isMeasuredUnit(goal.unit)
}

// Checks a card and builds what to save. Returns { error } with a translation
// key, or { statements, skillIds, experienceId }. Usually one statement; a
// card with several sets for a goal gives one more per extra set, each with
// that set's value only (its duration and note stay on the first), so every
// set is its own activity, as when logged one by one.
export function buildCardStatement(card, goals, actor, experiences = []) {
  const title = card.title.trim()
  if (!title) return { error: 'quickLog.errorTitle' }
  if (!card.date || card.date > localDateString()) return { error: 'quickLog.errorDate' }
  if (card.skills.length === 0) return { error: 'quickLog.errorSkill' }
  const minutes = card.durationMinutes.trim() === '' ? 0 : Number(card.durationMinutes)
  if (!Number.isInteger(minutes) || minutes < 0) return { error: 'quickLog.errorDuration' }
  const experience = card.experienceId ? experiences.find((other) => other.id === card.experienceId) ?? null : null
  if (experience && ((experience.start_date && card.date < experience.start_date) || (experience.end_date && card.date > experience.end_date))) {
    return { error: 'quickLog.errorExperienceDate' }
  }

  const measurements = []
  const extraSets = []
  for (const entry of card.goalValues) {
    const goal = goals.find((other) => other.id === entry.goalId)
    if (!goal) continue
    const input = goalInput(entry)
    const problem = validateEntryInput(goal, input)
    if (problem) return { error: problem, goal }
    measurements.push(buildGoalMeasurement(goal, input))
    if (!goalTakesSets(goal)) continue
    for (const set of entry.extraSets ?? []) {
      const setInput = { ...input, value: set.trim() }
      const setProblem = validateEntryInput(goal, setInput)
      if (setProblem) return { error: setProblem, goal }
      extraSets.push(buildGoalMeasurement(goal, setInput))
    }
  }

  const timestamp = cardTimestamp(card.date)
  const shared = {
    actor,
    verbValue: card.verb,
    activityName: title,
    timestamp,
    relatedSkills: card.skills.map((skill) => ({ id: skill.id, name: skill.name })),
    relatedExperience: experience,
  }
  const statements = [
    buildStatement({
      ...shared,
      description: card.note.trim() || null,
      durationHours: Math.floor(minutes / 60),
      durationMinutes: minutes % 60,
      measurements,
    }),
    ...extraSets.map((measurement) => buildStatement({ ...shared, description: null, measurements: [measurement] })),
  ]
  return { statements, skillIds: card.skills.map((skill) => skill.id), experienceId: experience?.id ?? null }
}
