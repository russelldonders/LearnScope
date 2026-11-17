import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import AppHeader from '../../components/AppHeader'
import MutationFeedback from '../../components/MutationFeedback'
import {
  getEmployerRoleProfile,
  updateEmployerRoleProfile,
  replaceEmployerRoleSkillRequirements,
  replaceEmployerRoleTrainingRequirements,
  assignEmployerRoleProfile,
  withdrawEmployerRoleAssignment,
  listEmployerRoleAssignments,
  toRoleProfileViewModel,
  getEmployerRoleProfileReadiness,
  isRoleProfileActive,
} from '../../lib/employerRoleProfiles'
import StatusBadge from '../../components/StatusBadge'
import { listEmployerSkillConfirmations, confirmEmployerSkillLevel } from '../../lib/employerSkillTargets'
import { listEmployerCatalogueCourses, listEmployerCatalogueSkills, listEmployerMembers } from '../../lib/admin/employers'
import { getOrganisation } from '../../lib/admin/organisations'
import { findOrCreateLibrarySkill, listLibrarySkills } from '../../lib/skillLibrary'
import { suggestRoleProfileSkills } from '../../lib/roleProfileSkillSuggestions'
import { useAuth } from '../../context/AuthContext'
import RoleProfileDetailsForm from './roles/RoleProfileDetailsForm'
import RoleProfileSkillsPanel from './roles/RoleProfileSkillsPanel'
import RoleProfileTrainingPanel from './roles/RoleProfileTrainingPanel'
import RoleProfileLinkedEmployeesPanel from './roles/RoleProfileLinkedEmployeesPanel'

const TABS = [
  { id: 'skills', label: 'Skills' },
  { id: 'courses', label: 'Courses' },
  { id: 'users', label: 'Users' },
]

// A role profile's own full-page editor -- reached by clicking its row in
// EmployerRoleProfilesConsole's table, the same "table lists, its own page
// edits" split ProviderCourseEditor/AdminUserDetail already use elsewhere.
// The name/description form stays permanently visible above the tabs
// (there's little enough "info" beyond those two fields that a dedicated
// tab for it would be one click for no real benefit); Skills/Courses/Users
// each get their own tab, one list with its own add/remove per tab, mapping
// onto the same required-skills/training-requirements/linked-employees
// concepts the table's own summary counts are drawn from.
export default function EmployerRoleProfileDetail() {
  const { roleProfileId } = useParams()
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [employer, setEmployer] = useState(null)
  const [members, setMembers] = useState([])
  const [availableSkills, setAvailableSkills] = useState([])
  const [availableCourses, setAvailableCourses] = useState([])
  const [readiness, setReadiness] = useState({})
  const [confirmations, setConfirmations] = useState({})
  const [tab, setTab] = useState('skills')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rawProfile = await getEmployerRoleProfile(roleProfileId)
      if (!rawProfile) {
        setNotFound(true)
        return
      }
      const [employerData, membersData, assignments] = await Promise.all([
        getOrganisation(rawProfile.employerId),
        listEmployerMembers(rawProfile.employerId),
        listEmployerRoleAssignments(roleProfileId),
      ])
      // Skills: scoped to the employer's attached provider org's own offered-
      // skills roster, not the platform's global skill library. Courses:
      // listEmployerCatalogueCourses now takes the employer id itself (not
      // provider_organisation_id) -- it resolves to whatever this provider
      // has actually confirmed sharing with this employer
      // (list_employer_shared_courses, 20260912152917), not just anything
      // published in the attached org.
      // The global skill library is offered too, so an employer with no
      // offered-skills roster of its own can still define what a role needs;
      // the organisation's own skills are listed first and win on overlap.
      const [organisationSkills, librarySkills, coursesData] = await Promise.all([
        listEmployerCatalogueSkills(employerData.id),
        listLibrarySkills(),
        listEmployerCatalogueCourses(employerData.id),
      ])
      const organisationSkillIds = new Set(organisationSkills.map((s) => s.id))
      const skillsData = [
        ...organisationSkills.map((s) => ({ ...s, fromOrganisation: true })),
        ...librarySkills.filter((s) => !organisationSkillIds.has(s.id)),
      ]
      const memberByUserId = new Map(membersData.map((m) => [m.user_id, m]))
      const nextProfile = toRoleProfileViewModel(rawProfile, assignments, memberByUserId)
      setProfile(nextProfile)
      setEmployer(employerData)
      setMembers(membersData)
      setAvailableSkills(skillsData)
      setAvailableCourses(coursesData.map((c) => ({ id: c.id, title: c.name })))

      const acceptedUserIds = nextProfile.linkedEmployees
        .filter((employee) => employee.status === 'accepted')
        .map((employee) => employee.userId)
      setReadiness(await getEmployerRoleProfileReadiness(rawProfile.employerId, nextProfile, acceptedUserIds))
      setConfirmations(
        await listEmployerSkillConfirmations(
          rawProfile.employerId,
          acceptedUserIds,
          nextProfile.requiredSkills.map((s) => s.skillId)
        )
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [roleProfileId])

  useEffect(() => { load() }, [load])

  async function mutate(action) {
    setSaving(true)
    setError(null)
    try {
      await action()
      await load()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  function handleRequestSkillSuggestions(excludedSkillNames) {
    return suggestRoleProfileSkills(
      { roleName: profile.name, roleDescription: profile.description },
      availableSkills.map((s) => s.name),
      excludedSkillNames
    )
  }

  // Adds a skill found by search, created from the search text, or accepted
  // from an AI suggestion. Without a skillId the skill is created in the
  // shared skill library first (findOrCreateLibrarySkill reuses any active
  // entry with the same name instead of duplicating it). Resolves true once
  // added, so the add UI can clear/advance only on success.
  function handleAddSkill({ skillId, name, targetLevel }) {
    return mutate(async () => {
      const resolvedId = skillId ?? await findOrCreateLibrarySkill(name, null, user.id)
      if (profile.requiredSkills.some((s) => s.skillId === resolvedId)) return
      await replaceEmployerRoleSkillRequirements(roleProfileId, [...profile.requiredSkills, { skillId: resolvedId, targetLevel }])
    })
  }

  async function handleSaveDetails(values) {
    if (await mutate(() => updateEmployerRoleProfile(roleProfileId, values))) setEditingDetails(false)
  }

  function handleToggleStatus() {
    mutate(() => updateEmployerRoleProfile(roleProfileId, { status: isRoleProfileActive(profile) ? 'archived' : 'active' }))
  }

  function handleUpdateTargetLevel(skillId, targetLevel) {
    mutate(() => replaceEmployerRoleSkillRequirements(
      roleProfileId,
      profile.requiredSkills.map((s) => (s.skillId === skillId ? { ...s, targetLevel } : s))
    ))
  }

  function handleRemoveSkill(skillId) {
    mutate(() => replaceEmployerRoleSkillRequirements(
      roleProfileId,
      profile.requiredSkills.filter((s) => s.skillId !== skillId)
    ))
  }

  function handleAddTraining({ courseId, requirement }) {
    const course = availableCourses.find((c) => c.id === courseId)
    if (!course) return
    mutate(() => replaceEmployerRoleTrainingRequirements(roleProfileId, [...profile.training, { courseId, title: course.title, requirement }]))
  }

  function handleUpdateRequirement(courseId, requirement) {
    mutate(() => replaceEmployerRoleTrainingRequirements(
      roleProfileId,
      profile.training.map((t) => (t.courseId === courseId ? { ...t, requirement } : t))
    ))
  }

  function handleRemoveTraining(courseId) {
    mutate(() => replaceEmployerRoleTrainingRequirements(
      roleProfileId,
      profile.training.filter((t) => t.courseId !== courseId)
    ))
  }

  // Proposes the role to every selected employer_member id -- one RPC call
  // each (Promise.allSettled, same partial-failure shape as EmployerConsole
  // .jsx's own bulk actions) rather than a single all-or-nothing call, so
  // one already-linked/removed-mid-session member doesn't block the rest of
  // a multi-select batch.
  function handleAssignEmployees(memberIds, { startDate = null, endDate = null } = {}) {
    mutate(async () => {
      const results = await Promise.allSettled(
        memberIds.map((id) => assignEmployerRoleProfile(roleProfileId, id, startDate, endDate))
      )
      const failures = results.filter((r) => r.status === 'rejected')
      if (failures.length === results.length) {
        throw new Error(failures[0]?.reason?.message || 'Failed to assign the selected employees.')
      }
    })
  }

  function handleWithdrawAssignment(assignmentId) {
    mutate(() => withdrawEmployerRoleAssignment(assignmentId))
  }

  // Records the reported level shown here as employer-confirmed -- this is
  // what makes a role profile's required target actually "met" on the
  // employee's own skills page, rather than a bare self-assessment (see
  // computeVisibleTarget in skillTargetPrecedence.js). Passes the exact
  // level currently shown rather than re-reading it server-side, so the
  // confirmation stays historically accurate even if the employee's own
  // self-assessment changes later.
  function handleConfirmSkill(userId, librarySkillId, level) {
    mutate(() => confirmEmployerSkillLevel(employer.id, userId, librarySkillId, level))
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader hideNavLinks />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        {/* Reconstructed from the loaded profile's own employer_id, not
            passed-through navigation state -- so this always returns to the
            right employer/section even after a refresh or a bookmarked link
            straight to this profile. Falls back to a bare /employer before
            it's loaded. */}
        <Link
          to={employer ? `/organisation?org=${employer.id}&section=roles` : '/organisation'}
          className="text-sm text-secondary hover:text-ink mb-4 inline-block"
        >
          ← Back to role profiles
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Role profile not found.</p>}

        {!loading && !notFound && (
          <>
            {/* One shared banner for whichever action last failed, rather
                than repeating the same message (and role="alert") across
                every leaf panel below. */}
            {error && <MutationFeedback status="error" message={error} className="mb-4" />}

            {profile && (
              <div className="space-y-6">
                {editingDetails ? (
                  <RoleProfileDetailsForm
                    roleProfile={profile}
                    saving={saving}
                    onSave={handleSaveDetails}
                    onCancel={() => setEditingDetails(false)}
                  />
                ) : (
                  <div className="bg-card border border-hairline rounded-lg p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h1 className="font-display text-2xl text-ink break-words">{profile.name}</h1>
                          {isRoleProfileActive(profile)
                            ? <StatusBadge label="Active" tone="success" />
                            : <StatusBadge label="Inactive" tone="neutral" />}
                        </div>
                        <p className="text-sm text-secondary mt-2 whitespace-pre-line">
                          {profile.description || 'No description yet.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingDetails(true)}
                          disabled={saving}
                          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                        >
                          Edit details
                        </button>
                        <button
                          type="button"
                          onClick={handleToggleStatus}
                          disabled={saving}
                          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
                        >
                          {isRoleProfileActive(profile) ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </div>
                    {!isRoleProfileActive(profile) && (
                      <p className="text-xs text-secondary mt-3">
                        This role profile is inactive: it can&apos;t be assigned to anyone new. People already linked keep it.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center flex-wrap gap-1 border-b border-hairline">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                        tab === t.id ? 'border-moss text-ink' : 'border-transparent text-secondary hover:text-ink'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'skills' && (
                  <RoleProfileSkillsPanel
                    roleName={profile.name}
                    requiredSkills={profile.requiredSkills}
                    availableSkills={availableSkills}
                    saving={saving}
                    onAddSkill={handleAddSkill}
                    onRequestSuggestions={handleRequestSkillSuggestions}
                    onUpdateTargetLevel={handleUpdateTargetLevel}
                    onRemoveSkill={handleRemoveSkill}
                  />
                )}
                {tab === 'courses' && (
                  <RoleProfileTrainingPanel
                    training={profile.training}
                    availableCourses={availableCourses}
                    saving={saving}
                    onAddTraining={handleAddTraining}
                    onUpdateRequirement={handleUpdateRequirement}
                    onRemoveTraining={handleRemoveTraining}
                  />
                )}
                {tab === 'users' && (
                  <RoleProfileLinkedEmployeesPanel
                    employees={profile.linkedEmployees}
                    members={members}
                    requiredSkills={profile.requiredSkills}
                    training={profile.training}
                    readiness={readiness}
                    confirmations={confirmations}
                    assigning={saving}
                    onAssignEmployees={handleAssignEmployees}
                    onWithdrawAssignment={handleWithdrawAssignment}
                    onConfirmSkill={handleConfirmSkill}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
