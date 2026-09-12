import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useNavVisibility } from '../../context/NavVisibilityContext'
import { supabase } from '../../lib/supabaseClient'
import { listCurrentRoleExperiences } from '../../lib/currentRole'
import {
  buildLearnerRoleAlignment,
  decideEmployerRoleAssignment,
  disconnectEmployerRoleAssignment,
  listMyEmployerRoleAssignments,
} from '../../lib/employerRoleProfiles'
import { getLearnerCompositeProgressForSkills } from '../../lib/skillComposites'

function toAssignment(assignment) {
  return {
    assignmentId: assignment.id,
    employerName: assignment.employer?.name ?? 'Employer',
    proposedAt: assignment.proposedAt,
    linkedAt: assignment.decidedAt,
    linkedExperienceId: assignment.currentRole?.id ?? null,
    roleProfile: {
      ...assignment.roleProfile,
      requiredSkills: assignment.roleProfile.skillRequirements,
      training: assignment.roleProfile.trainingRequirements.map((item) => ({ ...item, title: item.name })),
    },
  }
}

// Shared data/mutation layer behind every "my role assignments" surface --
// LearnerRoleAlignmentContainer (EmployerHome.jsx's employer-branded
// dashboard) and ExperienceSection.jsx's own timeline integration both use
// this rather than each fetching+computing alignment independently, so a
// pending/accepted assignment reads identically wherever it's shown.
// employerId optionally scopes to one employer (EmployerHome's own usage);
// omitted, every employer's assignments come back (Experience page's own
// usage -- a learner's timeline covers every employer, not just one).
export function useMyRoleAssignments(employerId) {
  const { user } = useAuth()
  const { refreshNavVisibility } = useNavVisibility()
  const [currentRoles, setCurrentRoles] = useState([])
  const [assignments, setAssignments] = useState([])
  const [personalSkills, setPersonalSkills] = useState([])
  const [personalCourses, setPersonalCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [compositeProgressBySkillId, setCompositeProgressBySkillId] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [roles, allRoleAssignments, skillsResult, coursesResult] = await Promise.all([
        listCurrentRoleExperiences(user.id),
        listMyEmployerRoleAssignments(user.id),
        supabase.from('skills').select('id, name, level, library_skill_id').eq('user_id', user.id),
        supabase.from('courses').select('id, catalogue_course_id, completed_date').eq('user_id', user.id),
      ])
      if (skillsResult.error) throw skillsResult.error
      if (coursesResult.error) throw coursesResult.error
      const roleAssignments = employerId
        ? allRoleAssignments.filter((assignment) => assignment.employer?.id === employerId)
        : allRoleAssignments
      const compositeSkillIds = [...new Set(roleAssignments.flatMap((assignment) =>
        assignment.roleProfile.skillRequirements
          .filter((requirement) => requirement.isComposite)
          .map((requirement) => requirement.skillId)
      ))]
      const nextCompositeProgress = await getLearnerCompositeProgressForSkills(compositeSkillIds, user.id)
      setCurrentRoles(roles.map((role) => ({ ...role, since: role.start_date })))
      setAssignments(roleAssignments)
      setPersonalSkills((skillsResult.data ?? []).map((skill) => ({ ...skill, librarySkillId: skill.library_skill_id })))
      setPersonalCourses((coursesResult.data ?? []).map((course) => ({ ...course, catalogueCourseId: course.catalogue_course_id, completedDate: course.completed_date })))
      setCompositeProgressBySkillId(nextCompositeProgress)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user.id, employerId])

  useEffect(() => { load() }, [load])

  const pendingAssignments = useMemo(
    () => assignments.filter((item) => item.status === 'proposed').map(toAssignment),
    [assignments]
  )
  const linkedAssignments = useMemo(
    () => assignments.filter((item) => item.status === 'linked').map(toAssignment),
    [assignments]
  )
  const alignmentByAssignmentId = useMemo(() => Object.fromEntries(
    assignments.filter((item) => item.status === 'linked').map((assignment) => {
      const alignment = buildLearnerRoleAlignment(
        assignment.roleProfile,
        personalSkills,
        personalCourses,
        compositeProgressBySkillId
      )
      const mapped = alignment.skills.map((skill) => ({ ...skill, learnerLevel: skill.currentLevel }))
      return [assignment.id, {
        aligned: mapped.filter((skill) => skill.gap === 0),
        gaps: mapped.filter((skill) => skill.gap > 0),
        training: alignment.training,
      }]
    })
  ), [assignments, compositeProgressBySkillId, personalCourses, personalSkills])

  async function mutate(action) {
    setLoading(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return {
    currentRoles,
    pendingAssignments,
    linkedAssignments,
    alignmentByAssignmentId,
    loading,
    error,
    // NavVisibilityContext's Skills nav link is fetched once per session,
    // not reactively (see its own comment) -- accepting can create this
    // learner's very first skill, so without this refresh the link stays
    // hidden until an unrelated full page reload happens to remount it.
    // Same pattern Dashboard.jsx's own FindSkillModal.onCreated already
    // uses for the exact same reason.
    acceptAssignment: (assignmentId, experienceId) => mutate(async () => {
      await decideEmployerRoleAssignment(assignmentId, true, experienceId)
      refreshNavVisibility()
    }),
    declineAssignment: (assignmentId) => mutate(() => decideEmployerRoleAssignment(assignmentId, false)),
    disconnectAssignment: (assignmentId) => mutate(() => disconnectEmployerRoleAssignment(assignmentId)),
  }
}
