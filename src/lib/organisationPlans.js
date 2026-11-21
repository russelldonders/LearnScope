import { supabase } from './supabaseClient'

// An organisation's own plans (learner_plans.organisation_id, 0328): built by
// its admins from its catalogue courses, skill library and plain steps, and
// assigned to its members. Assigning adds nothing to a member's record; only
// their Start joins them, after which the organisation sees their progress.

function throwIfError(error) {
  if (error) throw error
}

const PLAN_COLUMNS = 'id, title, description, status, target_on, created_at, updated_at'

export async function listOrganisationPlans(organisationId) {
  const { data, error } = await supabase
    .from('learner_plans')
    .select(`${PLAN_COLUMNS}, learner_plan_items(count), learner_plan_assignments(status)`)
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []).map(({ learner_plan_items: items, learner_plan_assignments: assignments, ...plan }) => ({
    ...plan,
    stepCount: items?.[0]?.count ?? 0,
    assignedCount: (assignments ?? []).filter((a) => a.status !== 'dismissed').length,
    startedCount: (assignments ?? []).filter((a) => a.status === 'started').length,
  }))
}

export async function getOrganisationPlan(planId) {
  const { data, error } = await supabase
    .from('learner_plans')
    .select(`${PLAN_COLUMNS}, organisation_id, learner_plan_items(id, item_type, position, step_title, note, plan_practical_level, catalogue_course_id, library_skill_id, created_at, course_catalogue(name, provider), skill_library(name))`)
    .eq('id', planId)
    .maybeSingle()
  throwIfError(error)
  if (!data) return null
  const { learner_plan_items: items, ...plan } = data
  return {
    ...plan,
    items: [...(items ?? [])].sort((a, b) => a.position - b.position || String(a.created_at).localeCompare(String(b.created_at))),
  }
}

// It goes active straight away: an organisation plan is a template its admins
// assign, not something they work through themselves. It belongs to the
// organisation, so it has no personal owner (user_id); the database records
// who created it.
export async function createOrganisationPlan(organisationId, { title, description, targetOn }) {
  const { data, error } = await supabase
    .from('learner_plans')
    .insert({
      organisation_id: organisationId,
      title: title.trim(),
      description: description?.trim() || null,
      target_on: targetOn || null,
      status: 'active',
    })
    .select('id')
    .single()
  throwIfError(error)
  return data.id
}

export async function updateOrganisationPlan(planId, { title, description, targetOn }) {
  const { error } = await supabase
    .from('learner_plans')
    .update({ title: title.trim(), description: description?.trim() || null, target_on: targetOn || null })
    .eq('id', planId)
  throwIfError(error)
}

export async function archiveOrganisationPlan(planId, archived) {
  const { error } = await supabase.from('learner_plans').update({ status: archived ? 'archived' : 'active' }).eq('id', planId)
  throwIfError(error)
}

export async function deleteOrganisationPlan(planId) {
  const { error } = await supabase.from('learner_plans').delete().eq('id', planId)
  throwIfError(error)
}

// step: { type: 'course', catalogueCourseId } | { type: 'skill', librarySkillId, practicalLevel }
//     | { type: 'step', title }, with an optional note.
export async function addOrganisationPlanStep(planId, step, position) {
  const row = { plan_id: planId, item_type: step.type, position, note: step.note?.trim() || null }
  if (step.type === 'course') row.catalogue_course_id = step.catalogueCourseId
  if (step.type === 'skill') {
    row.library_skill_id = step.librarySkillId
    row.plan_practical_level = step.practicalLevel
  }
  if (step.type === 'step') row.step_title = step.title.trim()
  const { error } = await supabase.from('learner_plan_items').insert(row)
  throwIfError(error)
}

export async function removeOrganisationPlanStep(itemId) {
  const { error } = await supabase.from('learner_plan_items').delete().eq('id', itemId)
  throwIfError(error)
}

export async function reorderOrganisationPlanSteps(itemIds) {
  const { error } = await supabase.rpc('reorder_learner_plan_items', { p_item_ids: itemIds })
  throwIfError(error)
}

// Library skills an organisation plan can use: the organisation's own, and
// the shared library's public ones.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function searchPlanLibrarySkills(organisationId, query) {
  if (!UUID.test(organisationId)) throw new Error('Unknown organisation')
  let request = supabase
    .from('skill_library')
    .select('id, name, category')
    .eq('status', 'active')
    .or(`organisation_id.eq.${organisationId},and(organisation_id.is.null,is_private.eq.false)`)
    .order('name')
    .limit(20)
  const term = query.trim().replace(/[%_,()]/g, ' ')
  if (term) request = request.ilike('name', `%${term}%`)
  const { data, error } = await request
  throwIfError(error)
  return data ?? []
}

// Catalogue courses an organisation plan can use: the organisation's own
// current courses, and those shared with it by linked providers.
export async function listPlanCatalogueCourses(organisationId) {
  const [own, shared] = await Promise.all([
    supabase
      .from('course_catalogue')
      .select('id, name')
      .eq('organisation_id', organisationId)
      .eq('is_current_published', true)
      .order('name'),
    supabase.rpc('list_employer_shared_courses', { p_employer: organisationId }),
  ])
  throwIfError(own.error)
  const byId = new Map()
  for (const course of [...(own.data ?? []), ...(shared.error ? [] : shared.data ?? [])]) {
    if (!byId.has(course.id)) byId.set(course.id, { id: course.id, name: course.name })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function assignOrganisationPlan(planId, userIds) {
  const { data, error } = await supabase.rpc('assign_learner_plan', { p_plan_id: planId, p_user_ids: userIds })
  throwIfError(error)
  return data ?? 0
}

export async function withdrawPlanAssignment(assignmentId) {
  const { error } = await supabase.rpc('withdraw_learner_plan_assignment', { p_assignment_id: assignmentId })
  throwIfError(error)
}

export async function listOrganisationPlanProgress(planId) {
  const { data, error } = await supabase.rpc('list_organisation_learner_plan_progress', { p_plan_id: planId })
  throwIfError(error)
  return data ?? []
}

// The member's side.

export async function listMyPlanAssignments(organisationId = null) {
  const { data, error } = await supabase.rpc('list_my_learner_plan_assignments', { p_organisation_id: organisationId })
  throwIfError(error)
  return data ?? []
}

// Starting joins the member as a follower (making their own planned course
// and skill for its steps); returns the plan id.
export async function respondToPlanAssignment(assignmentId, start) {
  const { data, error } = await supabase.rpc('respond_to_learner_plan_assignment', { p_assignment_id: assignmentId, p_start: start })
  throwIfError(error)
  return data
}

// How far through the organisation plan a member is, for the console: the
// latest status of each step they recorded, by step id.
export function stepStatusesOf(person) {
  return new Map((person.progress_items ?? []).map((entry) => [entry.item_id, entry.status]))
}
