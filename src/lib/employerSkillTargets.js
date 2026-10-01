import { supabase } from './supabaseClient'

// Employer-admin-facing: latest confirmed level per member+skill, for the
// role profile's own readiness panel. Returns a plain object keyed by
// "userId:librarySkillId" (rather than a Map) since it's consumed directly
// as readiness-style lookup data by RoleProfileLinkedEmployeesPanel.
export async function listEmployerSkillConfirmations(employerId, userIds, librarySkillIds) {
  if (userIds.length === 0 || librarySkillIds.length === 0) return {}
  const { data, error } = await supabase
    .from('employer_skill_confirmations')
    .select('user_id, library_skill_id, confirmed_level, created_at')
    .eq('employer_id', employerId)
    .in('user_id', userIds)
    .in('library_skill_id', librarySkillIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  const latest = {}
  for (const row of data ?? []) {
    const key = `${row.user_id}:${row.library_skill_id}`
    if (!(key in latest)) latest[key] = row.confirmed_level
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
