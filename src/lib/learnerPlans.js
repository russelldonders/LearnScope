import { supabase } from './supabaseClient'
import { computeGoalProgress, goalDueOn, localDateString } from './skillGoalProgress'
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
  step_title, step_skill_id, completion_statement_id, note, target_on, completed_on, plan_knowledge_level, plan_practical_level, created_at,
  courses(id, name, provider, completed_date, status, cancelled_at, catalogue_course_id),
  skills:skills!learner_plan_items_skill_id_fkey(id, name, level, knowledge_level, lifecycle_stage, library_skill_id, practical_level_guide),
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

// A plan invitation never grants access to the source plan. The recipient
// sees only the deliberately small preview returned by the RPC; accepting
// creates a separate private plan owned by them.
export async function listPlanInvitations(planId) {
  const { data, error } = await supabase
    .from('learner_plan_invitations')
    .select('id, recipient_id, status, created_at')
    .eq('source_plan_id', planId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function inviteConnectionsToPlan(planId, recipientIds) {
  const { data, error } = await supabase.rpc('invite_connections_to_learner_plan', {
    p_plan_id: planId,
    p_recipient_ids: recipientIds,
  })
  if (error) throw error
  return data ?? []
}

// Everyone invited to a plan, for its owner: the latest invitation per
// person, where it stands, and the progress shared by those who accepted.
export async function listPlanMembers(planId) {
  const { data, error } = await supabase.rpc('list_learner_plan_members', { p_plan_id: planId })
  if (error) throw error
  return data ?? []
}

// Accepting an invitation shares progress with the inviter. Progress is
// worked out here, from the learner's own records, so each time a page works
// it out it records the counts (only done / total) on any accepted
// invitation the plan was copied from. Resolves to the set of these plans
// whose progress is shared; plans not copied from an invitation are ignored.
export async function recordPlanProgress(entries) {
  if (entries.length === 0) return new Set()
  const { data, error } = await supabase.rpc('record_learner_plan_progress', {
    p_progress: entries.map(({ planId, done, total }) => ({ plan_id: planId, done, total })),
  })
  if (error) throw error
  return new Set((data ?? []).map((row) => (typeof row === 'string' ? row : row.record_learner_plan_progress)))
}

export async function listIncomingPlanInvitations() {
  const { data, error } = await supabase.rpc('list_incoming_learner_plan_invitations')
  if (error) throw error
  return data ?? []
}

export async function respondToPlanInvitation(invitationId, accept) {
  const { data, error } = await supabase.rpc('respond_to_learner_plan_invitation', {
    p_invitation_id: invitationId,
    p_accept: accept,
  })
  if (error) throw error
  return data
}

// What planItemStatus needs beyond the items themselves: the learner's goals
// (to follow a replaced goal to its successor) and progress on the active
// ones, worked out exactly as on the dashboard. Skill targets live on their
// plan items and are deliberately separate from the learner's own targets.
export async function loadPlanContext(userId, items) {
  const needsGoals = items.some((i) => i.skill_goal_id)
  const [goals, activeGoals] = await Promise.all([
    needsGoals
      ? supabase.from('skill_goals').select('id, title, status, replaces_goal_id, skill_id, skills!inner(user_id)').eq('skills.user_id', userId)
      : Promise.resolve({ data: [] }),
    needsGoals ? listActiveGoalsWithActivities(userId) : Promise.resolve([]),
  ])
  if (goals.error) throw goals.error

  const goalsById = new Map((goals.data ?? []).map((goal) => [goal.id, goal]))
  const replacedBy = new Map()
  for (const goal of goals.data ?? []) if (goal.replaces_goal_id) replacedBy.set(goal.replaces_goal_id, goal.id)
  // Each active goal as its tile needs it (as on Home), so a plan can show the
  // goal itself rather than sending the learner to its skill's page.
  const goalItemsById = new Map(activeGoals.map((item) => {
    const progress = computeGoalProgress(item.goal, item.statements)
    return [item.goal.id, { ...item, progress, nextLog: goalDueOn(item.goal, progress) }]
  }))
  const goalProgressById = new Map([...goalItemsById].map(([id, item]) => [id, item.progress]))

  return { goalsById, replacedBy, goalProgressById, goalItemsById, today: localDateString() }
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

export async function addItem(planId, { itemType, recordId, stepTitle, stepSkillId, sectionId, note, targetOn, position, planKnowledgeLevel, planPracticalLevel }) {
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
  if (itemType === 'skill') {
    row.plan_knowledge_level = planKnowledgeLevel ? Number(planKnowledgeLevel) : null
    row.plan_practical_level = planPracticalLevel ? Number(planPracticalLevel) : null
    // Skills are shown in their own plan-wide section, never inside an
    // activity section even if an older caller sends one.
    row.section_id = null
  }
  const { error } = await supabase.from('learner_plan_items').insert(row)
  if (error) throw error
}

export async function updateItem(itemId, { note, targetOn, sectionId, stepTitle, stepSkillId, planKnowledgeLevel, planPracticalLevel }) {
  const changes = { note: blankToNull(note), target_on: targetOn || null, section_id: sectionId || null }
  if (stepTitle !== undefined) changes.step_title = stepTitle.trim()
  if (stepSkillId !== undefined) changes.step_skill_id = stepSkillId || null
  if (planKnowledgeLevel !== undefined) changes.plan_knowledge_level = planKnowledgeLevel ? Number(planKnowledgeLevel) : null
  if (planPracticalLevel !== undefined) changes.plan_practical_level = planPracticalLevel ? Number(planPracticalLevel) : null
  if (planKnowledgeLevel !== undefined || planPracticalLevel !== undefined) changes.section_id = null
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

// A done item's recorded activity, to see whether it carries anything the
// learner added (a comment or evidence) before unticking it.
export async function getItemActivity(item) {
  if (!item.completion_statement_id) return null
  const { data, error } = await supabase
    .from('xapi_statements')
    .select('id, statement, evidence_paths, evidence_url')
    .eq('id', item.completion_statement_id)
    .maybeSingle()
  if (error) throw error
  return data
}

// Whether an activity holds something the learner wrote or attached.
export function activityHasLearnerContent(row) {
  return Boolean(
    row?.statement?.object?.definition?.description
    || row?.evidence_paths?.length
    || row?.evidence_url,
  )
}

// Ticking a step or resource records it as an activity in the learner's
// activity log, through saveActivity like every other activity, and links
// the item to it. A step can be marked done on an earlier day, with a
// comment (the activity's description) and evidence (a link and files).
//
// Unticking clears the tick and, by default, removes that activity unless
// it has anything of the learner's in it. removeActivity true or false
// overrides that, for when the learner has been asked.
export async function setItemDone(item, done, { userId, actor, completedOn = null, comment = '', evidence = null, removeActivity } = {}) {
  if (done) {
    // Already ticked (a second click, or another tab): nothing to record.
    if (item.completion_statement_id || item.completed_on) return
    const day = completedOn || localDateString()
    const { name, skill } = itemActivity(item)
    const statement = buildStatement({
      actor,
      verbValue: 'completed',
      activityName: name,
      description: comment?.trim() || undefined,
      // Midday on the day, so it stays on that day wherever it's read.
      timestamp: day === localDateString() ? new Date().toISOString() : new Date(`${day}T12:00:00`).toISOString(),
      relatedSkills: skill ? [{ id: skill.id, name: skill.name }] : [],
    })
    const hasEvidence = Boolean(evidence?.evidenceUrl?.trim() || evidence?.files?.length)
    const row = await saveActivity({
      userId,
      statement,
      evidence: hasEvidence ? { evidenceUrl: evidence.evidenceUrl?.trim() || null, files: evidence.files ?? [] } : null,
      skillIds: skill ? [skill.id] : [],
    })
    const { error } = await supabase
      .from('learner_plan_items')
      .update({ completed_on: day, completion_statement_id: row.id })
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
  if (item.completion_statement_id && removeActivity !== false) {
    const row = await getItemActivity(item)
    // Only ever the activity this item recorded.
    const isItsActivity = row && row.id === item.completion_statement_id
    if (removeActivity === true ? isItsActivity : isUneditedPlanActivity(row, item)) await deleteActivity(row)
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
