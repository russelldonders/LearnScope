import { supabase } from './supabaseClient'

// The employer-set target for each skill the caller (the signed-in learner)
// tracks, reconciled from the two places an employer can set one: a role
// profile's required level (only for profiles the learner has actually
// accepted -- employer_role_assignments.status = 'linked') and a direct
// employer_skill_suggestions.suggested_target_level (while still active --
// 'suggested' or 'adopted', not 'dismissed'). When both exist for the same
// skill, the higher one wins -- see computeVisibleTarget in
// skillTargetPrecedence.js for how this then reconciles against the
// learner's own personal target. Every query here relies on RLS to already
// scope results to the caller's own rows; nothing is filtered by user id
// client-side.
export async function getEmployerTargetsForUser() {
  const targetsByLibraryId = new Map()
  const considerTarget = (libraryId, level, employerId, source) => {
    if (!libraryId || level == null) return
    const existing = targetsByLibraryId.get(libraryId)
    if (!existing || level > existing.level) {
      targetsByLibraryId.set(libraryId, { level, employerId, source })
    }
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from('employer_role_assignments')
    .select('role_profile_id, employer_member:employer_member_id(employer_id)')
    .eq('status', 'linked')
  if (assignmentError) throw assignmentError

  if ((assignments ?? []).length > 0) {
    const roleProfileIds = [...new Set(assignments.map((a) => a.role_profile_id))]
    const employerIdByProfileId = new Map(assignments.map((a) => [a.role_profile_id, a.employer_member?.employer_id]))
    const { data: requirementRows, error: requirementError } = await supabase
      .from('employer_role_profile_skills')
      .select('role_profile_id, library_skill_id, target_level')
      .in('role_profile_id', roleProfileIds)
    if (requirementError) throw requirementError
    for (const row of requirementRows ?? []) {
      considerTarget(row.library_skill_id, row.target_level, employerIdByProfileId.get(row.role_profile_id), 'role_profile')
    }
  }

  const { data: suggestions, error: suggestionError } = await supabase
    .from('employer_skill_suggestions')
    .select('employer_id, skill_library_id, suggested_target_level, status')
    .in('status', ['suggested', 'adopted'])
  if (suggestionError) throw suggestionError
  for (const row of suggestions ?? []) {
    considerTarget(row.skill_library_id, row.suggested_target_level, row.employer_id, 'suggestion')
  }

  return targetsByLibraryId
}

// The caller's own latest confirmed level per employer+skill (history-
// preserving table, most recent row wins -- see the migration's own
// comment). Keyed by "employerId:librarySkillId" since the same skill could
// in principle carry a target -- and a confirmation -- from more than one
// employer.
export async function getLatestEmployerSkillConfirmations() {
  const { data, error } = await supabase
    .from('employer_skill_confirmations')
    .select('employer_id, library_skill_id, confirmed_level, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  const latestByKey = new Map()
  for (const row of data ?? []) {
    const key = `${row.employer_id}:${row.library_skill_id}`
    if (!latestByKey.has(key)) latestByKey.set(key, row.confirmed_level)
  }
  return latestByKey
}

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
