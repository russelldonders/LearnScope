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

export { mapRoleProfile }
