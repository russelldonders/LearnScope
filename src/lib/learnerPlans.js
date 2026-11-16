import { supabase } from './supabaseClient'
import { computeGoalProgress, localDateString } from './skillGoalProgress'
import { listActiveGoalsWithActivities } from './skillGoals'
import { saveActivity } from './activitySkillLinks'
import { deleteActivity } from './activityEdits'
import { buildStatement } from './xapiStatement'

// A learner's own plans (20261116100000_0295_learner_plans.sql): ordered
// sections of items, each pointing at one of their records or a free-text
// step. Progress is worked out in planProgress.js from those records.

// Items point at skills twice (a skill item, and the skill a step develops),
// so both are named by their foreign key.
const ITEM_COLUMNS = `id, plan_id, section_id, position, item_type, course_id, skill_id, skill_goal_id, skill_resource_id,
  step_title, step_skill_id, completion_statement_id, note, target_on, completed_on, created_at,
  courses(id, name, provider, completed_date, status, cancelled_at, catalogue_course_id),
  skills:skills!learner_plan_items_skill_id_fkey(id, name, level, lifecycle_stage, library_skill_id, practical_level_guide),
  step_skill:skills!learner_plan_items_step_skill_id_fkey(id, name),
  skill_goals(id, title, status, skill_id),
  skill_resources(id, title, kind, url, file_path, skill_id, skills(id, name))`

export async function listPlans() {
  const { data, error } = await supabase
    .from('learner_plans')
    .select(`*, learner_plan_items(${ITEM_COLUMNS})`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(({ learner_plan_items: items, ...plan }) => ({ ...plan, items: items ?? [] }))
}

export async function getPlan(planId) {
  const [plan, sections, items] = await Promise.all([
    supabase.from('learner_plans').select('*').eq('id', planId).maybeSingle(),
    supabase.from('learner_plan_sections').select('*').eq('plan_id', planId).order('position').order('created_at'),
    supabase.from('learner_plan_items').select(ITEM_COLUMNS).eq('plan_id', planId).order('position').order('created_at'),
  ])
  for (const result of [plan, sections, items]) if (result.error) throw result.error
  if (!plan.data) return null
  return { ...plan.data, sections: sections.data ?? [], items: items.data ?? [] }
}

// What planItemStatus needs beyond the items themselves: each skill's latest
// target, the learner's goals (to follow a replaced goal to its successor)
// and progress on the active ones, worked out exactly as on the dashboard.
export async function loadPlanContext(userId, items) {
  const skillIds = [...new Set(items.filter((i) => i.skill_id).map((i) => i.skill_id))]
  const needsGoals = items.some((i) => i.skill_goal_id)
  const [targets, goals, activeGoals] = await Promise.all([
    skillIds.length
      ? supabase.from('skill_targets').select('skill_id, target_level, target_date, created_at').in('skill_id', skillIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    needsGoals
      ? supabase.from('skill_goals').select('id, title, status, replaces_goal_id, skill_id, skills!inner(user_id)').eq('skills.user_id', userId)
      : Promise.resolve({ data: [] }),
    needsGoals ? listActiveGoalsWithActivities(userId) : Promise.resolve([]),
  ])
  if (targets.error) throw targets.error
  if (goals.error) throw goals.error

  const latestTargetBySkill = new Map()
  for (const target of targets.data ?? []) {
    if (!latestTargetBySkill.has(target.skill_id)) latestTargetBySkill.set(target.skill_id, target)
  }
  const goalsById = new Map((goals.data ?? []).map((goal) => [goal.id, goal]))
  const replacedBy = new Map()
  for (const goal of goals.data ?? []) if (goal.replaces_goal_id) replacedBy.set(goal.replaces_goal_id, goal.id)
  const goalProgressById = new Map(activeGoals.map((item) => [item.goal.id, computeGoalProgress(item.goal, item.statements)]))

  return { latestTargetBySkill, goalsById, replacedBy, goalProgressById, today: localDateString() }
}

// The learner's records that can go into a plan.
export async function listPlannableRecords(userId) {
  const [courses, skills, goals, resources] = await Promise.all([
    supabase.from('courses').select('id, name, provider, status, completed_date').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('skills').select('id, name, library_skill_id').eq('user_id', userId).or('lifecycle_stage.is.null,lifecycle_stage.neq.archived').order('name'),
    supabase.from('skill_goals').select('id, title, status, skill_id, skills!inner(name, user_id)').eq('skills.user_id', userId).in('status', ['active', 'achieved']).order('created_at', { ascending: false }),
    supabase.from('skill_resources').select('id, title, kind, skill_id').eq('user_id', userId).order('created_at', { ascending: false }),
  ])
  for (const result of [courses, skills, goals, resources]) if (result.error) throw result.error
  return {
    course: courses.data ?? [],
    skill: skills.data ?? [],
    skill_goal: (goals.data ?? []).map(({ skills: skill, ...goal }) => ({ ...goal, skill_name: skill?.name ?? null })),
    skill_resource: resources.data ?? [],
  }
}

const blankToNull = (value) => (typeof value === 'string' ? value.trim() || null : value ?? null)

export async function createPlan(userId, { title, description, startsOn, targetOn }) {
  const { data, error } = await supabase
    .from('learner_plans')
    .insert({
      user_id: userId,
      title: title.trim(),
      description: blankToNull(description),
      starts_on: startsOn || null,
      target_on: targetOn || null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updatePlan(planId, { title, description, startsOn, targetOn }) {
  const { error } = await supabase
    .from('learner_plans')
    .update({ title: title.trim(), description: blankToNull(description), starts_on: startsOn || null, target_on: targetOn || null })
    .eq('id', planId)
  if (error) throw error
}

// Completing records the day; reopening clears it.
export async function setPlanStatus(planId, status) {
  const { error } = await supabase
    .from('learner_plans')
    .update({ status, completed_on: status === 'completed' ? localDateString() : null })
    .eq('id', planId)
  if (error) throw error
}

// A plan in preparation becomes ready to use. Without a start date, it
// starts today, so its timeframe and pace have something to go by.
export async function startPlan(plan) {
  const changes = { status: 'active', completed_on: null }
  const today = localDateString()
  if (!plan.starts_on && (!plan.target_on || plan.target_on >= today)) changes.starts_on = today
  const { error } = await supabase.from('learner_plans').update(changes).eq('id', plan.id)
  if (error) throw error
}

// Removes the plan and its sections and items, never the records they point at.
export async function deletePlan(planId) {
  const { error } = await supabase.from('learner_plans').delete().eq('id', planId)
  if (error) throw error
}

export async function addSection(planId, { title, targetOn, position }) {
  const { error } = await supabase
    .from('learner_plan_sections')
    .insert({ plan_id: planId, title: title.trim(), target_on: targetOn || null, position })
  if (error) throw error
}

export async function updateSection(sectionId, { title, targetOn }) {
  const { error } = await supabase
    .from('learner_plan_sections')
    .update({ title: title.trim(), target_on: targetOn || null })
    .eq('id', sectionId)
  if (error) throw error
}

// Its items move to the top of the plan rather than being removed.
export async function deleteSection(sectionId) {
  const { error } = await supabase.from('learner_plan_sections').delete().eq('id', sectionId)
  if (error) throw error
}

const REFERENCE_COLUMN = {
  course: 'course_id',
  skill: 'skill_id',
  skill_goal: 'skill_goal_id',
  skill_resource: 'skill_resource_id',
}

export async function addItem(planId, { itemType, recordId, stepTitle, stepSkillId, sectionId, note, targetOn, position }) {
  const row = {
    plan_id: planId,
    section_id: sectionId || null,
    item_type: itemType,
    note: blankToNull(note),
    target_on: targetOn || null,
    position,
  }
  if (itemType === 'step') {
    row.step_title = stepTitle.trim()
    row.step_skill_id = stepSkillId || null
  } else {
    row[REFERENCE_COLUMN[itemType]] = recordId
  }
  const { error } = await supabase.from('learner_plan_items').insert(row)
  if (error) throw error
}

export async function updateItem(itemId, { note, targetOn, sectionId, stepTitle, stepSkillId }) {
  const changes = { note: blankToNull(note), target_on: targetOn || null, section_id: sectionId || null }
  if (stepTitle !== undefined) changes.step_title = stepTitle.trim()
  if (stepSkillId !== undefined) changes.step_skill_id = stepSkillId || null
  const { error } = await supabase.from('learner_plan_items').update(changes).eq('id', itemId)
  if (error) throw error
}

// What a ticked item records: its title, and the skill it's linked to (a
// step's chosen skill, or the skill a resource belongs to).
function itemActivity(item) {
  if (item.item_type === 'step') {
    return { name: item.step_title, skill: item.step_skill ?? null }
  }
  const resource = item.skill_resources
  return { name: resource?.title, skill: resource?.skills ?? null }
}

// The activity a tick recorded, still as recorded: the one the item points
// at, under the same name, with nothing added since (a description, a
// duration or measurements, evidence). Only then does unticking take it
// away. The activity is an ordinary one -- the learner can edit it like any
// other -- so a change they've made is what keeps it.
export function isUneditedPlanActivity(row, item) {
  const definition = row?.statement?.object?.definition
  return Boolean(
    row
    && item.completion_statement_id
    && row.id === item.completion_statement_id
    && definition?.name?.['en-US'] === itemActivity(item).name
    && !definition?.description
    && !row.statement.result
    && !(row.evidence_paths?.length)
    && !row.evidence_url,
  )
}

// Ticking a step or resource records it as an activity in the learner's
// activity log, through saveActivity like every other activity, and links
// the item to it. Unticking removes that activity -- unless the learner has
// since edited it, in which case it's theirs to keep -- and clears the tick.
export async function setItemDone(item, done, { userId, actor }) {
  if (done) {
    // Already ticked (a second click, or another tab): nothing to record.
    if (item.completion_statement_id || item.completed_on) return
    const { name, skill } = itemActivity(item)
    const statement = buildStatement({
      actor,
      verbValue: 'completed',
      activityName: name,
      timestamp: new Date().toISOString(),
      relatedSkills: skill ? [{ id: skill.id, name: skill.name }] : [],
    })
    const row = await saveActivity({ userId, statement, evidence: null, skillIds: skill ? [skill.id] : [] })
    const { error } = await supabase
      .from('learner_plan_items')
      .update({ completed_on: localDateString(), completion_statement_id: row.id })
      .eq('id', item.id)
    if (error) {
      // Don't leave an activity behind for a tick that didn't save.
      await deleteActivity(row).catch(() => {})
      throw error
    }
    return
  }

  // The activity first: if removing it fails, the item stays ticked and the
  // learner sees why, rather than a stray activity being left behind.
  if (item.completion_statement_id) {
    const { data: row, error: readError } = await supabase
      .from('xapi_statements')
      .select('id, statement, evidence_paths, evidence_url')
      .eq('id', item.completion_statement_id)
      .maybeSingle()
    if (readError) throw readError
    if (isUneditedPlanActivity(row, item)) await deleteActivity(row)
  }
  const { error } = await supabase
    .from('learner_plan_items')
    .update({ completed_on: null, completion_statement_id: null })
    .eq('id', item.id)
  if (error) throw error
}

// Takes the item off the plan; its record stays where it is.
export async function removeItem(itemId) {
  const { error } = await supabase.from('learner_plan_items').delete().eq('id', itemId)
  if (error) throw error
}

// Saves a new order: rows are { id, position } in the order wanted.
export async function savePositions(table, rows) {
  const results = await Promise.all(
    rows.map((row) => supabase.from(table).update({ position: row.position }).eq('id', row.id)),
  )
  const failed = results.find((result) => result.error)
  if (failed) throw failed.error
}

// The learner's name, for the activities their ticks record (xAPI actor).
export async function getActorName(userId) {
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name ?? ''
}
