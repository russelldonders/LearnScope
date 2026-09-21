import { supabase } from './supabaseClient'

export const EMPLOYER_MANAGEMENT_RELATIONSHIP_TYPES = Object.freeze([
  'primary',
  'functional',
  'project',
  'delegate',
])

export const EMPLOYER_MANAGEMENT_ACCESS_SCOPES = Object.freeze([
  'employment',
  'role_assignments',
  'training_assignments',
  'skill_management',
  'shared_skills',
  'shared_skill_evidence',
  'shared_training',
  'shared_experience',
])

function throwIfError(error) {
  if (error) throw error
}

export async function listEmployerManagementRelationships(employerId) {
  const { data, error } = await supabase
    .from('employer_management_relationships')
    .select('*')
    .eq('employer_id', employerId)
    .order('valid_from', { ascending: false })
    .order('created_at', { ascending: false })
  throwIfError(error)
  return data ?? []
}

// Mutations are deliberately RPC-only. The database verifies employer-admin
// authority, active same-employer memberships, effective dates, and cycles.
export async function createEmployerManagementRelationship({
  employerId,
  managerMemberId,
  employeeMemberId,
  relationshipType,
  isPrimary = false,
  includeIndirectReports = false,
  accessScope,
  validFrom,
  validUntil,
}) {
  const params = {
    p_employer_id: employerId,
    p_manager_member_id: managerMemberId,
    p_employee_member_id: employeeMemberId,
    p_relationship_type: relationshipType,
    p_is_primary: isPrimary,
    p_include_indirect_reports: includeIndirectReports,
    p_access_scope: accessScope,
    p_valid_until: validUntil || null,
  }
  if (validFrom) params.p_valid_from = validFrom

  const { data, error } = await supabase.rpc('create_employer_management_relationship', params)
  throwIfError(error)
  return data
}

export async function updateEmployerManagementRelationship(relationshipId, changes) {
  const { error } = await supabase.rpc('update_employer_management_relationship', {
    p_relationship_id: relationshipId,
    p_relationship_type: changes.relationshipType,
    p_is_primary: changes.isPrimary,
    p_include_indirect_reports: changes.includeIndirectReports,
    p_access_scope: changes.accessScope,
    p_valid_from: changes.validFrom,
    p_valid_until: changes.validUntil || null,
  })
  throwIfError(error)
}

export async function endEmployerManagementRelationship(relationshipId, validUntil) {
  const params = {
    p_relationship_id: relationshipId,
  }
  if (validUntil) params.p_valid_until = validUntil

  const { error } = await supabase.rpc('end_employer_management_relationship', params)
  throwIfError(error)
}

export async function canManageEmployerMember(employeeMemberId, scope = null, allowIndirect = true) {
  const { data, error } = await supabase.rpc('can_manage_employer_member', {
    p_employee_member_id: employeeMemberId,
    p_scope: scope,
    p_allow_indirect: allowIndirect,
  })
  throwIfError(error)
  return Boolean(data)
}

export async function listEmployerDirectReports(employerId) {
  const { data, error } = await supabase.rpc('list_employer_direct_reports', {
    p_employer_id: employerId,
  })
  throwIfError(error)
  return data ?? []
}

export async function listEmployerIndirectReports(employerId) {
  const { data, error } = await supabase.rpc('list_employer_indirect_reports', {
    p_employer_id: employerId,
  })
  throwIfError(error)
  return data ?? []
}

export async function listManageableEmployerMembers(employerId) {
  const { data, error } = await supabase.rpc('list_manageable_employer_members', {
    p_employer_id: employerId,
  })
  throwIfError(error)
  return data ?? []
}

export async function listEmployerMemberManagers(employeeMemberId) {
  const { data, error } = await supabase.rpc('list_employer_member_managers', {
    p_employee_member_id: employeeMemberId,
  })
  throwIfError(error)
  return data ?? []
}

export async function listMyEmployerManagementContexts() {
  const { data, error } = await supabase.rpc('list_my_employer_management_contexts')
  throwIfError(error)
  return (data ?? []).map((row) => ({
    employerId: row.employer_id,
    employerName: row.employer_name,
    employerSlug: row.employer_slug,
    managerMemberId: row.manager_member_id,
    directReportCount: Number(row.direct_report_count ?? 0),
    indirectReportCount: Number(row.indirect_report_count ?? 0),
  }))
}

export async function listMyEmployerTeam(employerId) {
  const { data, error } = await supabase.rpc('list_my_employer_team', {
    p_employer_id: employerId,
  })
  throwIfError(error)
  return (data ?? []).map((row) => ({
    employeeMemberId: row.employee_member_id,
    employeeUserId: row.employee_user_id,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    reportDepth: Number(row.report_depth ?? 1),
    accessScope: row.access_scope ?? [],
    relationshipTypes: row.relationship_types ?? [],
    isPrimary: Boolean(row.is_primary),
  }))
}

export async function getMyEmployerTeamMemberSnapshot(employerId, employeeMemberId) {
  const { data, error } = await supabase.rpc('get_my_employer_team_member_snapshot', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
  })
  throwIfError(error)
  return data
}

export async function listManagerAssignableCourses(employerId, employeeMemberId) {
  const { data, error } = await supabase.rpc('list_manager_assignable_courses', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
  })
  throwIfError(error)
  return data ?? []
}

export async function assignCourseToManagedEmployerMember(employerId, employeeMemberId, catalogueCourseId) {
  const { data, error } = await supabase.rpc('assign_course_to_managed_employer_member', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
    p_catalogue_course_id: catalogueCourseId,
  })
  throwIfError(error)
  return data
}

export async function listManagerSuggestibleSkills(employerId, employeeMemberId) {
  const { data, error } = await supabase.rpc('list_manager_suggestible_skills', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
  })
  throwIfError(error)
  return data ?? []
}

export async function listManagedEmployerSkillDevelopmentTargets(employerId, employeeMemberId) {
  const { data, error } = await supabase.rpc('list_managed_employer_skill_development_targets', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
  })
  throwIfError(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    skillLibraryId: row.skill_library_id,
    skillName: row.skill_name,
    targetLevel: Number(row.target_level),
    targetDate: row.target_date,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  }))
}

export async function setManagedEmployerSkillDevelopmentTarget(
  employerId,
  employeeMemberId,
  skillLibraryId,
  { targetLevel, targetDate, notes = null }
) {
  const { data, error } = await supabase.rpc('set_managed_employer_skill_development_target', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
    p_skill_library_id: skillLibraryId,
    p_target_level: targetLevel,
    p_target_date: targetDate,
    p_notes: notes?.trim() || null,
  })
  throwIfError(error)
  return data
}

export async function closeManagedEmployerSkillDevelopmentTarget(targetId, status) {
  const { error } = await supabase.rpc('close_managed_employer_skill_development_target', {
    p_target_id: targetId,
    p_status: status,
  })
  throwIfError(error)
}

export async function suggestSkillToManagedEmployerMember(
  employerId,
  employeeMemberId,
  skillLibraryId,
  { targetLevel = null, targetDate = null, comments = null } = {}
) {
  const { data, error } = await supabase.rpc('suggest_skill_to_managed_employer_member', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
    p_skill_library_id: skillLibraryId,
    p_target_level: targetLevel,
    p_target_date: targetDate || null,
    p_comments: comments?.trim() || null,
  })
  throwIfError(error)
  return data
}

export async function confirmManagedEmployerSkillLevel(
  employerId,
  employeeMemberId,
  skillLibraryId,
  level
) {
  const { data, error } = await supabase.rpc('confirm_managed_employer_skill_level', {
    p_employer_id: employerId,
    p_employee_member_id: employeeMemberId,
    p_skill_library_id: skillLibraryId,
    p_level: level,
  })
  throwIfError(error)
  return data
}
