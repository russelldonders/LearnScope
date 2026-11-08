import { supabase } from './supabaseClient'
import { fetchStatementsForSkill, saveActivity } from './activitySkillLinks'
import { buildStatement } from './xapiStatement'
import {
  ACTIVITY_COUNT_METRIC,
  PRACTICE_MINUTES_METRIC,
  applyEntryCorrection,
  buildGoalMeasurement,
  dateToTimestamp,
  entryDurationMinutes,
  localDateString,
  resolveMetric,
  slugifyMetric,
} from './skillGoalProgress'

const GOAL_COLUMNS =
  'id, skill_id, original_text, title, metric, measure_kind, unit, direction, aggregation, period, target_value, target_date, started_on, tracker_question, log_every_days, status, closed_on, replaces_goal_id, created_at'

export async function listSkillGoals(skillId) {
  const { data, error } = await supabase
    .from('skill_goals')
    .select(GOAL_COLUMNS)
    .eq('skill_id', skillId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Every goal the learner is working towards, with its skill and that skill's
// activities, for the dashboard. A skill's activities are read in full, as on
// the skill's page, so progress and baselines come out exactly the same.
export async function listActiveGoalsWithActivities(userId) {
  const { data, error } = await supabase
    .from('skill_goals')
    .select(`${GOAL_COLUMNS}, skills!inner(id, name, user_id)`)
    .eq('status', 'active')
    .eq('skills.user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const goals = data ?? []
  const skillIds = [...new Set(goals.map((goal) => goal.skill_id))]
  const statementsBySkill = new Map(
    await Promise.all(
      skillIds.map(async (skillId) => [
        skillId,
        await fetchStatementsForSkill(skillId, 'id, recorded_at, statement, resource_id, evidence_paths'),
      ]),
    ),
  )
  return goals.map(({ skills, ...goal }) => ({
    goal,
    skill: { id: skills.id, name: skills.name },
    statements: statementsBySkill.get(goal.skill_id) ?? [],
  }))
}

// Asks AI to turn what the learner wrote into a draft. Returns
// { outcome: 'goal', goal } or { outcome: 'clarify' | 'level_target' | 'unsafe',
// message, options }. Nothing is saved here.
export async function draftSkillGoal({ text, skillName, existingGoals, language }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')

  const res = await fetch('/api/suggest-tags', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      operation: 'skill-goal',
      text,
      skillName,
      language,
      today: localDateString(),
      existingMeasures: (existingGoals ?? []).map((goal) => ({
        metric: goal.metric,
        unit: goal.unit,
        measure_kind: goal.measure_kind,
      })),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Failed to draft this goal.')
  return body
}

function fixedMetricFor(kind) {
  if (kind === 'activities') return ACTIVITY_COUNT_METRIC
  if (kind === 'practice_time') return PRACTICE_MINUTES_METRIC
  return null
}

export async function createSkillGoal(skillId, values, existingGoals) {
  const { measure_kind: kind, unit } = values
  const metric =
    fixedMetricFor(kind) ??
    resolveMetric(values.metric || slugifyMetric(`${values.title} ${unit}`), kind, unit, values.aggregation, existingGoals)
  const { data, error } = await supabase
    .from('skill_goals')
    .insert({ ...values, metric, skill_id: skillId })
    .select(GOAL_COLUMNS)
    .single()
  if (error) throw error
  return data
}

// Wording and rhythm can be corrected in place. A new target or date is a new
// goal that replaces this one, so what the learner was aiming for at the time
// stays on record. It's still the same effort, so it keeps its start date and
// the progress made so far.
export async function updateSkillGoal(goal, changes) {
  const targetChanged = Number(goal.target_value ?? NaN) !== Number(changes.target_value ?? NaN)
    && !(goal.target_value == null && changes.target_value == null)
  const dateChanged = (goal.target_date ?? null) !== (changes.target_date ?? null)

  if (!targetChanged && !dateChanged) {
    const { error } = await supabase
      .from('skill_goals')
      .update({
        title: changes.title,
        tracker_question: changes.tracker_question,
        log_every_days: changes.log_every_days,
      })
      .eq('id', goal.id)
    if (error) throw error
    return
  }

  const today = localDateString()
  const { error: insertError } = await supabase.from('skill_goals').insert({
    skill_id: goal.skill_id,
    original_text: goal.original_text,
    title: changes.title,
    metric: goal.metric,
    measure_kind: goal.measure_kind,
    unit: goal.unit,
    direction: goal.direction,
    aggregation: goal.aggregation,
    period: goal.period,
    target_value: changes.target_value,
    target_date: changes.target_date,
    started_on: goal.started_on,
    tracker_question: changes.tracker_question,
    log_every_days: changes.log_every_days,
    replaces_goal_id: goal.id,
  })
  if (insertError) throw insertError

  const { error: closeError } = await supabase
    .from('skill_goals')
    .update({ status: 'replaced', closed_on: today })
    .eq('id', goal.id)
  if (closeError) throw closeError
}

export async function stopSkillGoal(goalId) {
  const { error } = await supabase
    .from('skill_goals')
    .update({ status: 'stopped', closed_on: localDateString() })
    .eq('id', goalId)
  if (error) throw error
}

// Removes the goal only. Everything logged against it stays in the activity
// log, because those activities are the learner's record of what they did.
export async function deleteSkillGoal(goalId) {
  const { error } = await supabase.from('skill_goals').delete().eq('id', goalId)
  if (error) throw error
}

// A date picked in the form means that day, but an entry for today keeps the
// actual time so it sorts correctly and counts straight away.
function entryTimestamp(date) {
  return date === localDateString() ? new Date().toISOString() : dateToTimestamp(date)
}

// Saved as a normal activity, through the same path as every other activity.
// It's named after the skill and never the goal: goals are private, but
// activities can be read by validators of the skill and by linked accounts.
export async function logGoalEntry({ goal, skill, userId, actor, input, date, note, activityTitle, evidence }) {
  const minutes = entryDurationMinutes(goal, input)
  const statement = buildStatement({
    actor,
    verbValue: 'practiced',
    activityName: activityTitle || skill.name,
    description: note || null,
    timestamp: entryTimestamp(date),
    relatedSkills: [{ id: skill.id, name: skill.name }],
    durationHours: Math.floor(minutes / 60),
    durationMinutes: minutes % 60,
    measurements: [buildGoalMeasurement(goal, input)],
  })
  return saveActivity({ userId, statement, evidence, skillIds: [skill.id] })
}

export async function correctGoalEntry({ row, goal, input, date, note, activityTitle }) {
  const sameDay = localDateString(new Date(row.recorded_at)) === date
  const timestamp = sameDay ? new Date(row.recorded_at).toISOString() : entryTimestamp(date)
  const statement = applyEntryCorrection(row.statement, goal, { input, timestamp, note, activityTitle })
  const { data, error } = await supabase
    .from('xapi_statements')
    .update({ statement, recorded_at: timestamp })
    .eq('id', row.id)
    .select('id')
  if (error) throw error
  // RLS turns someone else's row into "0 rows changed" rather than an error.
  if (!data?.length) throw new Error("This entry couldn't be changed from this account.")
}

// Permanently removes the activity and any evidence files attached to it.
export async function deleteGoalEntry(row) {
  const { data, error } = await supabase.from('xapi_statements').delete().eq('id', row.id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error("This entry couldn't be deleted from this account.")
  const paths = row.evidence_paths ?? []
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('skill-evidence').remove(paths)
    if (storageError) {
      console.error('Could not remove evidence files for a deleted entry:', storageError)
      throw new Error("The entry was deleted, but its attached files couldn't be removed.")
    }
  }
}
