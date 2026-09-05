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

function toConsoleProfile(profile, assignments) {
  return {
    ...profile,
    requiredSkills: profile.skillRequirements,
    training: profile.trainingRequirements.map((item) => ({ ...item, title: item.name })),
    linkedEmployeeCount: assignments.filter((item) => ['proposed', 'linked'].includes(item.status)).length,
  }
}

export default function EmployerRoleProfilesSection({ employer, user, searchParams, setSearchParams }) {
  const [profiles, setProfiles] = useState([])
  const [assignmentsByProfile, setAssignmentsByProfile] = useState({})
  const [members, setMembers] = useState([])
  const [skills, setSkills] = useState([])
  const [courses, setCourses] = useState([])
  const [selectedId, setSelectedId] = useState(null)
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
      setSelectedId((current) => nextProfiles.some((profile) => profile.id === current) ? current : nextProfiles[0]?.id ?? null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [employer.id, employer.provider_organisation_id])

  useEffect(() => { load() }, [load])

  const roleProfiles = useMemo(
    () => profiles.map((profile) => toConsoleProfile(profile, assignmentsByProfile[profile.id] ?? [])),
    [profiles, assignmentsByProfile]
  )
  const linkedEmployees = useMemo(() => {
    const memberByUserId = new Map(members.map((member) => [member.user_id, member]))
    return (assignmentsByProfile[selectedId] ?? [])
      .filter((assignment) => ['proposed', 'linked'].includes(assignment.status))
      .map((assignment) => ({
        assignmentId: assignment.id,
        name: assignment.name,
        email: memberByUserId.get(assignment.userId)?.email ?? '',
        status: assignment.status === 'linked' ? 'accepted' : 'pending',
        assignedAt: assignment.proposedAt,
      }))
  }, [assignmentsByProfile, members, selectedId])

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
      selectedRoleProfileId={selectedId}
      searchParams={searchParams}
      setSearchParams={setSearchParams}
      availableSkills={skills}
      availableCourses={courses.map((course) => ({ id: course.id, title: course.name }))}
      linkedEmployees={linkedEmployees}
      loading={loading}
      error={error}
      onSelectRoleProfile={setSelectedId}
      onSaveRoleProfile={(profileId, values) => mutate(async () => {
        if (profileId) await updateEmployerRoleProfile(profileId, values)
        else {
          const id = await createEmployerRoleProfile(employer.id, values, user.id)
          setSelectedId(id)
        }
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
