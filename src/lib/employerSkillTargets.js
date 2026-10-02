import { supabase } from './supabaseClient'

// Employer-admin-facing: latest confirmed level per member+skill, for the
// role profile's own readiness panel. Returns a plain object keyed by
// "userId:librarySkillId" (rather than a Map) since it's consumed directly
// as readiness-style lookup data by RoleProfileLinkedEmployeesPanel. Reads
// the organisation's ratings from the unified manager_skill_ratings table.
export async function listEmployerSkillConfirmations(employerId, userIds, librarySkillIds) {
  if (userIds.length === 0 || librarySkillIds.length === 0) return {}
  const { data, error } = await supabase
    .from('manager_skill_ratings')
    .select('learner_id, skill_library_id, level, rated_at')
    .eq('context_type', 'organisation')
    .eq('employer_id', employerId)
    .in('learner_id', userIds)
    .in('skill_library_id', librarySkillIds)
    .order('rated_at', { ascending: false })
  if (error) throw error
  const latest = {}
  for (const row of data ?? []) {
    const key = `${row.learner_id}:${row.skill_library_id}`
    if (!(key in latest)) latest[key] = row.level
  }
  return latest
}

export async function confirmEmployerSkillLevel(employerId, userId, librarySkillId, level) {
  const { error } = await supabase.rpc('confirm_employer_skill_level', {
    p_employer_id: employerId,
    p_user_id: userId,
    p_library_skill_id: librarySkillId,
    p_level: level,
  })
  if (error) throw error
}
