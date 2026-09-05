import { useCallback, useEffect, useMemo, useState } from 'react'
import EmployerRoleProfilesConsole from './roles/EmployerRoleProfilesConsole'
import {
  assignEmployerRoleProfile,
  createEmployerRoleProfile,
  listEmployerRoleAssignments,
  listEmployerRoleProfiles,
  replaceEmployerRoleSkillRequirements,
  replaceEmployerRoleTrainingRequirements,
  updateEmployerRoleProfile,
  withdrawEmployerRoleAssignment,
} from '../../lib/employerRoleProfiles'
import { listEmployerCatalogueCourses, listEmployerMembers } from '../../lib/admin/employers'
import { listLibrarySkills } from '../../lib/skillLibrary'

// Every row's own linked-employees list is denormalized in here up front
// (not just a count) -- the console now opens a per-row "Assign users"
// dialog straight from the full-width table (no separate "selected profile"
// concept to fetch it lazily against), so each profile needs its full
// roster available the moment its row renders.
function toConsoleProfile(profile, assignments, memberByUserId) {
  const linkedEmployees = assignments
    .filter((assignment) => ['proposed', 'linked'].includes(assignment.status))
    .map((assignment) => ({
      assignmentId: assignment.id,
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

export default function EmployerRoleProfilesSection({ employer, user, searchParams, setSearchParams }) {
  const [profiles, setProfiles] = useState([])
  const [assignmentsByProfile, setAssignmentsByProfile] = useState({})
  const [members, setMembers] = useState([])
  const [skills, setSkills] = useState([])
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextProfiles, nextMembers, nextSkills, nextCourses] = await Promise.all([
        listEmployerRoleProfiles(employer.id),
        listEmployerMembers(employer.id),
        listLibrarySkills(),
        listEmployerCatalogueCourses(employer.provider_organisation_id),
      ])
      const assignmentEntries = await Promise.all(
        nextProfiles.map(async (profile) => [profile.id, await listEmployerRoleAssignments(profile.id)])
      )
      setProfiles(nextProfiles)
      setAssignmentsByProfile(Object.fromEntries(assignmentEntries))
      setMembers(nextMembers)
      setSkills(nextSkills)
      setCourses(nextCourses)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [employer.id, employer.provider_organisation_id])

  useEffect(() => { load() }, [load])

  const roleProfiles = useMemo(() => {
    const memberByUserId = new Map(members.map((member) => [member.user_id, member]))
    return profiles.map((profile) => toConsoleProfile(profile, assignmentsByProfile[profile.id] ?? [], memberByUserId))
  }, [profiles, assignmentsByProfile, members])

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
    <EmployerRoleProfilesConsole
      roleProfiles={roleProfiles}
      searchParams={searchParams}
      setSearchParams={setSearchParams}
      availableSkills={skills}
      availableCourses={courses.map((course) => ({ id: course.id, title: course.name }))}
      loading={loading}
      error={error}
      onSaveRoleProfile={(profileId, values) => mutate(async () => {
        if (profileId) await updateEmployerRoleProfile(profileId, values)
        else await createEmployerRoleProfile(employer.id, values, user.id)
      })}
      onReplaceSkills={(profileId, nextSkills) => mutate(() => replaceEmployerRoleSkillRequirements(profileId, nextSkills))}
      onReplaceTraining={(profileId, nextTraining) => mutate(() => replaceEmployerRoleTrainingRequirements(profileId, nextTraining))}
      onAssignEmployee={(profileId, email) => mutate(async () => {
        const normalizedEmail = email.trim().toLowerCase()
        const member = members.find((item) => item.email?.trim().toLowerCase() === normalizedEmail && item.status === 'active')
        if (!member) throw new Error('Choose an active learner from this employer using their account email.')
        await assignEmployerRoleProfile(profileId, member.id)
      })}
      onWithdrawAssignment={(assignmentId) => mutate(() => withdrawEmployerRoleAssignment(assignmentId))}
    />
  )
}
