import { supabase } from './supabaseClient'

const PROFILE_SELECT = `
  id, employer_id, name, description, status, created_at, updated_at,
  employer_role_profile_skills(
    library_skill_id, target_level, requirement,
    skill_library(id, name, category, skill_composite_definitions(status, skill_composite_components(id)))
  ),
  employer_role_profile_training(
    catalogue_course_id, requirement,
    course_catalogue(id, name, provider, course_type, duration)
  )
`

function mapRoleProfile(row) {
  return {
    id: row.id,
    employerId: row.employer_id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    skillRequirements: (row.employer_role_profile_skills ?? []).map((item) => {
      const publishedComposite = item.skill_library?.skill_composite_definitions?.find(
        (definition) => definition.status === 'published'
      )
      return {
        skillId: item.library_skill_id,
        name: item.skill_library?.name ?? 'Skill',
        category: item.skill_library?.category ?? null,
        targetLevel: item.target_level,
        requirement: item.requirement,
        isComposite: Boolean(publishedComposite),
        componentCount: publishedComposite?.skill_composite_components?.length ?? 0,
      }
    }),
    trainingRequirements: (row.employer_role_profile_training ?? []).map((item) => ({
      courseId: item.catalogue_course_id,
      name: item.course_catalogue?.name ?? 'Training',
      provider: item.course_catalogue?.provider ?? null,
      courseType: item.course_catalogue?.course_type ?? null,
      duration: item.course_catalogue?.duration ?? null,
      requirement: item.requirement,
    })),
  }
}

export async function listEmployerRoleProfiles(employerId) {
  const { data, error } = await supabase
    .from('employer_role_profiles')
    .select(PROFILE_SELECT)
    .eq('employer_id', employerId)
    .order('name')
  if (error) throw error
  return (data ?? []).map(mapRoleProfile)
}

// Single-row counterpart for the role profile's own detail page
// (EmployerRoleProfileDetail.jsx), reached directly by id (e.g. a bookmark
// or refresh) rather than always arriving via the employer's full list.
// maybeSingle (not single) so a deleted/inaccessible id resolves to null
// instead of throwing -- RLS already scopes this to employer admins of that
// profile's own employer, same as listEmployerRoleProfiles.
export async function getEmployerRoleProfile(profileId) {
  const { data, error } = await supabase
    .from('employer_role_profiles')
    .select(PROFILE_SELECT)
    .eq('id', profileId)
    .maybeSingle()
  if (error) throw error
  return data ? mapRoleProfile(data) : null
}

export async function createEmployerRoleProfile(employerId, profile, userId) {
  const { data, error } = await supabase
    .from('employer_role_profiles')
    .insert({
      employer_id: employerId,
      name: profile.name.trim(),
      description: profile.description?.trim() || null,
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function updateEmployerRoleProfile(profileId, changes) {
  const payload = { updated_at: new Date().toISOString() }
  if (changes.name !== undefined) payload.name = changes.name.trim()
  if (changes.description !== undefined) payload.description = changes.description?.trim() || null
  if (changes.status !== undefined) payload.status = changes.status
  const { error } = await supabase.from('employer_role_profiles').update(payload).eq('id', profileId)
  if (error) throw error
}

export async function replaceEmployerRoleSkillRequirements(profileId, requirements) {
  const { error } = await supabase.rpc('replace_employer_role_profile_skills', {
    p_role_profile_id: profileId,
    p_requirements: requirements.map((item) => ({
      skillId: item.skillId,
      targetLevel: item.targetLevel,
      requirement: item.requirement ?? 'required',
    })),
  })
  if (error) throw error
}

export async function replaceEmployerRoleTrainingRequirements(profileId, requirements) {
  const { error } = await supabase.rpc('replace_employer_role_profile_training', {
    p_role_profile_id: profileId,
    p_requirements: requirements.map((item) => ({
      courseId: item.courseId,
      requirement: item.requirement ?? 'required',
    })),
  })
  if (error) throw error
}

export async function assignEmployerRoleProfile(profileId, employerMemberId) {
  const { data, error } = await supabase.rpc('assign_employer_role_profile', {
    p_role_profile_id: profileId,
    p_employer_member_id: employerMemberId,
  })
  if (error) throw error
  return data
}

export async function decideEmployerRoleAssignment(assignmentId, accept, learnerExperienceId = null) {
  const { error } = await supabase.rpc('decide_employer_role_assignment', {
    p_assignment_id: assignmentId,
    p_accept: accept,
    p_learner_experience_id: accept ? learnerExperienceId : null,
  })
  if (error) throw error
}

export async function disconnectEmployerRoleAssignment(assignmentId) {
  const { error } = await supabase.rpc('disconnect_employer_role_assignment', {
    p_assignment_id: assignmentId,
  })
  if (error) throw error
}

export async function withdrawEmployerRoleAssignment(assignmentId) {
  const { error } = await supabase.rpc('withdraw_employer_role_assignment', {
    p_assignment_id: assignmentId,
  })
  if (error) throw error
}

export async function listEmployerRoleAssignments(profileId) {
  const { data, error } = await supabase.rpc('list_employer_role_assignments', {
    p_role_profile_id: profileId,
  })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    memberId: row.employer_member_id,
    userId: row.learner_user_id,
    name: row.learner_name,
    status: row.status,
    proposedAt: row.proposed_at,
    linkedAt: row.decided_at,
    currentRole: row.learner_experience_id ? {
      id: row.learner_experience_id,
      title: row.current_role_title,
      organization: row.current_role_organization,
    } : null,
  }))
}

export async function listMyEmployerRoleAssignments(userId) {
  const { data, error } = await supabase
    .from('employer_role_assignments')
    .select(`
      id, status, proposed_at, decided_at, disconnected_at, learner_experience_id,
      employer_members!inner(user_id),
      employer_role_profiles!inner(${PROFILE_SELECT}, employers(id, name)),
      experience(id, title, organization, start_date)
    `)
    .eq('employer_members.user_id', userId)
    .order('proposed_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    proposedAt: row.proposed_at,
    decidedAt: row.decided_at,
    disconnectedAt: row.disconnected_at,
    currentRole: row.experience ? {
      id: row.experience.id,
      title: row.experience.title,
      organization: row.experience.organization,
      startDate: row.experience.start_date,
    } : null,
    employer: row.employer_role_profiles?.employers ?? null,
    roleProfile: mapRoleProfile(row.employer_role_profiles),
  }))
}

// Learner-side alignment uses the learner's own complete data in their own
// session. This result is not an employer projection: employers continue to
// see only information shared through the existing consent allow-list.
export function buildLearnerRoleAlignment(roleProfile, personalSkills, personalCourses, compositeProgressBySkillId = {}) {
  const skillsByLibraryId = new Map(
    personalSkills
      .filter((skill) => skill.librarySkillId)
      .map((skill) => [skill.librarySkillId, skill])
  )
  const completedCourseIds = new Set(
    personalCourses
      .filter((course) => course.catalogueCourseId && course.completedDate)
      .map((course) => course.catalogueCourseId)
  )

  return {
    skills: roleProfile.skillRequirements.map((requirement) => {
      const personalSkill = skillsByLibraryId.get(requirement.skillId)
      const currentLevel = personalSkill?.level ?? null
      const compositeProgress = compositeProgressBySkillId[requirement.skillId] ?? null
      return {
        ...requirement,
        personalSkillId: personalSkill?.id ?? null,
        currentLevel,
        gap: currentLevel === null ? requirement.targetLevel : Math.max(requirement.targetLevel - currentLevel, 0),
        ...(compositeProgress ? { componentCoverage: compositeProgress.coverage } : {}),
      }
    }),
    training: roleProfile.trainingRequirements.map((requirement) => ({
      ...requirement,
      completed: completedCourseIds.has(requirement.courseId),
    })),
  }
}

// Denormalizes a raw mapRoleProfile() result plus its own
// listEmployerRoleAssignments rows into the shape the role-profile UI
// (RoleProfileList/RoleProfileSkillsPanel/RoleProfileTrainingPanel/
// RoleProfileLinkedEmployeesPanel) actually renders -- shared by both the
// full-roster table (EmployerRoleProfilesSection) and the single-profile
// detail page (EmployerRoleProfileDetail) so the two can't drift into
// different shapes for the same underlying data.
export function toRoleProfileViewModel(profile, assignments, memberByUserId) {
  const linkedEmployees = assignments
    .filter((assignment) => ['proposed', 'linked'].includes(assignment.status))
    .map((assignment) => ({
      assignmentId: assignment.id,
      userId: assignment.userId,
      name: assignment.name,
      email: memberByUserId.get(assignment.userId)?.email ?? '',
      status: assignment.status === 'linked' ? 'accepted' : 'pending',
      assignedAt: assignment.proposedAt,
    }))
  return {
    ...profile,
    requiredSkills: profile.skillRequirements,
    training: profile.trainingRequirements.map((item) => ({ ...item, title: item.name })),
    linkedEmployees,
    linkedEmployeeCount: linkedEmployees.length,
  }
}

// Employer-side readiness, for the linked-employees roster on a role
// profile's own page (EmployerRoleProfileDetail -- rendered by
// RoleProfileLinkedEmployeesPanel). Deliberately reuses the two access paths
// an employer admin already has rather than computing the learner's full
// alignment (that stays buildLearnerRoleAlignment's job, run only in the
// learner's own session): skills come straight from the `skills` table,
// so RLS's existing is_skill_shared_with_employer policy (20260904191500)
// silently limits results to whatever the employee already chose to share
// via the employer data-access flow (EmployerConsole's Users tab) -- an
// unshared skill just returns no row, read here as "not shared" rather than
// distinguished from "not tracked". Training comes from course_assignments
// scoped to this employer, which only ever reflects assigned/enrolled/
// dismissed (started, not completed -- see 20260902180000's own comment);
// it says nothing about a completion the learner reached on their own.
export async function getEmployerRoleProfileReadiness(employerId, profile, employeeUserIds) {
  const readiness = Object.fromEntries(employeeUserIds.map((userId) => [userId, { skills: {}, training: {} }]))
  if (employeeUserIds.length === 0) return readiness

  const skillIds = profile.skillRequirements.map((requirement) => requirement.skillId)
  if (skillIds.length > 0) {
    const { data, error } = await supabase
      .from('skills')
      .select('user_id, library_skill_id, level')
      .in('user_id', employeeUserIds)
      .in('library_skill_id', skillIds)
    if (error) throw error
    for (const row of data ?? []) {
      if (readiness[row.user_id]) readiness[row.user_id].skills[row.library_skill_id] = row.level
    }
  }

  const courseIds = profile.trainingRequirements.map((requirement) => requirement.courseId)
  if (courseIds.length > 0) {
    const { data, error } = await supabase
      .from('course_assignments')
      .select('assigned_to, catalogue_course_id, status')
      .eq('employer_id', employerId)
      .in('assigned_to', employeeUserIds)
      .in('catalogue_course_id', courseIds)
    if (error) throw error
    for (const row of data ?? []) {
      if (readiness[row.assigned_to]) readiness[row.assigned_to].training[row.catalogue_course_id] = row.status
    }
  }

  return readiness
}

// Resolves an organisation slug (Login.jsx's ?org=:slug) to the employer it
// belongs to, if any -- see get_employer_login_context's own comment
// (20260912090000) for why this can't just be a table read. Returns null
// for a slug with no employer attached (a plain training-provider org),
// which Login.jsx treats as "not an employer-gated login" rather than an
// error.
export async function getEmployerLoginContext(slug) {
  const { data, error } = await supabase.rpc('get_employer_login_context', { p_slug: slug })
  if (error) throw error
  return data ?? null
}

// A direct row read rather than going through AuthContext's own
// employerMemberships -- that only refreshes on the auth-state-change
// listener firing, which Login.jsx's own signIn() call can't reliably await
// before deciding whether to let an employer-gated sign-in through. RLS
// (is_employer_member) already scopes this to rows the caller can actually
// see, so a member of a *different* employer querying this employerId just
// gets no row back, same as a non-member -- filtering on status here only
// excludes this account's own not-yet-active row for this employer.
export async function getMyActiveEmployerMembership(employerId, userId) {
  const { data, error } = await supabase
    .from('employer_members')
    .select('role')
    .eq('employer_id', employerId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data
}

export { mapRoleProfile }
