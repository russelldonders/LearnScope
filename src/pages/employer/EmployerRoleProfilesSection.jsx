import { useCallback, useEffect, useMemo, useState } from 'react'
import EmployerRoleProfilesConsole from './roles/EmployerRoleProfilesConsole'
import {
  createEmployerRoleProfile,
  listEmployerRoleAssignments,
  listEmployerRoleProfiles,
  toRoleProfileViewModel,
} from '../../lib/employerRoleProfiles'
import { listEmployerMembers } from '../../lib/admin/employers'

// Drives the full-width role-profiles table only -- editing a single
// profile's own details/skills/training/linked-employees now happens on its
// own page (EmployerRoleProfileDetail.jsx, reached by clicking its row),
// not here. This still loads the whole roster (every profile's own
// requiredSkills/training/linkedEmployeeCount) since the table's columns
// summarize all of that per row.
export default function EmployerRoleProfilesSection({ employer, user, searchParams, setSearchParams, onOpenProfile }) {
  const [profiles, setProfiles] = useState([])
  const [assignmentsByProfile, setAssignmentsByProfile] = useState({})
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextProfiles, nextMembers] = await Promise.all([
        listEmployerRoleProfiles(employer.id),
        listEmployerMembers(employer.id),
      ])
      const assignmentEntries = await Promise.all(
        nextProfiles.map(async (profile) => [profile.id, await listEmployerRoleAssignments(profile.id)])
      )
      setProfiles(nextProfiles)
      setAssignmentsByProfile(Object.fromEntries(assignmentEntries))
      setMembers(nextMembers)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [employer.id])

  useEffect(() => { load() }, [load])

  const roleProfiles = useMemo(() => {
    const memberByUserId = new Map(members.map((member) => [member.user_id, member]))
    return profiles.map((profile) => toRoleProfileViewModel(profile, assignmentsByProfile[profile.id] ?? [], memberByUserId))
  }, [profiles, assignmentsByProfile, members])

  // Only ever called to create (the console no longer edits an existing
  // profile's name/description itself -- that's the detail page's job) --
  // returns the new profile's id so the console can navigate straight to
  // its detail page once created, the same way ProviderConsole's own
  // "+ Create training" flow does.
  async function handleCreate(values) {
    setLoading(true)
    setError(null)
    try {
      const id = await createEmployerRoleProfile(employer.id, values, user.id)
      await load()
      return id
    } catch (err) {
      setError(err.message)
      setLoading(false)
      return undefined
    }
  }

  return (
    <EmployerRoleProfilesConsole
      roleProfiles={roleProfiles}
      searchParams={searchParams}
      setSearchParams={setSearchParams}
      loading={loading}
      error={error}
      onCreateRoleProfile={handleCreate}
      onOpenProfile={onOpenProfile}
    />
  )
}
