import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { listCurrentRoleExperiences } from '../../lib/currentRole'
import {
  buildLearnerRoleAlignment,
  decideEmployerRoleAssignment,
  disconnectEmployerRoleAssignment,
  listMyEmployerRoleAssignments,
} from '../../lib/employerRoleProfiles'
import LearnerRoleAlignmentSection from './employer-link/LearnerRoleAlignmentSection'

function toAssignment(assignment) {
  return {
    assignmentId: assignment.id,
    employerName: assignment.employer?.name ?? 'Employer',
    proposedAt: assignment.proposedAt,
    linkedAt: assignment.decidedAt,
    roleProfile: {
      ...assignment.roleProfile,
      requiredSkills: assignment.roleProfile.skillRequirements,
      training: assignment.roleProfile.trainingRequirements.map((item) => ({ ...item, title: item.name })),
    },
  }
}

export default function LearnerRoleAlignmentContainer() {
  const { user } = useAuth()
  const [currentRoles, setCurrentRoles] = useState([])
  const [assignments, setAssignments] = useState([])
  const [personalSkills, setPersonalSkills] = useState([])
  const [personalCourses, setPersonalCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [roles, roleAssignments, skillsResult, coursesResult] = await Promise.all([
        listCurrentRoleExperiences(user.id),
        listMyEmployerRoleAssignments(user.id),
        supabase.from('skills').select('id, name, level, library_skill_id').eq('user_id', user.id),
        supabase.from('courses').select('id, catalogue_course_id, completed_date').eq('user_id', user.id),
      ])
      if (skillsResult.error) throw skillsResult.error
      if (coursesResult.error) throw coursesResult.error
      setCurrentRoles(roles.map((role) => ({ ...role, since: role.start_date })))
      setAssignments(roleAssignments)
      setPersonalSkills((skillsResult.data ?? []).map((skill) => ({ ...skill, librarySkillId: skill.library_skill_id })))
      setPersonalCourses((coursesResult.data ?? []).map((course) => ({ ...course, catalogueCourseId: course.catalogue_course_id, completedDate: course.completed_date })))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user.id])

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
      const alignment = buildLearnerRoleAlignment(assignment.roleProfile, personalSkills, personalCourses)
      const mapped = alignment.skills.map((skill) => ({ ...skill, learnerLevel: skill.currentLevel }))
      return [assignment.id, {
        aligned: mapped.filter((skill) => skill.gap === 0),
        gaps: mapped.filter((skill) => skill.gap > 0),
      }]
    })
  ), [assignments, personalCourses, personalSkills])

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

  return (
    <section aria-labelledby="role-alignment-heading">
      <div className="mb-6">
        <p className="text-xs font-medium text-secondary uppercase tracking-wide">Work alignment</p>
        <h2 id="role-alignment-heading" className="font-display text-2xl text-ink mt-1">Role profile connections</h2>
        <p className="text-sm text-secondary mt-2 max-w-2xl">
          Connect an employer's requirements to a current role you control. Your employer cannot edit your personal role, skills, or learning history.
        </p>
      </div>
      <LearnerRoleAlignmentSection
        currentRoles={currentRoles}
        pendingAssignments={pendingAssignments}
        linkedAssignments={linkedAssignments}
        alignmentByAssignmentId={alignmentByAssignmentId}
        linking={loading}
        disconnecting={loading}
        error={error}
        onAcceptAssignment={(assignmentId, roleId) => mutate(() => decideEmployerRoleAssignment(assignmentId, true, roleId))}
        onDeclineAssignment={(assignmentId) => mutate(() => decideEmployerRoleAssignment(assignmentId, false))}
        onDisconnectAssignment={(assignmentId) => mutate(() => disconnectEmployerRoleAssignment(assignmentId))}
      />
    </section>
  )
}
