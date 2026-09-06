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
} from '../../lib/employerRoleProfiles'
import { getEmployer, listEmployerCatalogueCourses, listEmployerMembers } from '../../lib/admin/employers'
import { listLibrarySkills } from '../../lib/skillLibrary'
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
  const [profile, setProfile] = useState(null)
  const [employer, setEmployer] = useState(null)
  const [members, setMembers] = useState([])
  const [availableSkills, setAvailableSkills] = useState([])
  const [availableCourses, setAvailableCourses] = useState([])
  const [tab, setTab] = useState('skills')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rawProfile = await getEmployerRoleProfile(roleProfileId)
      if (!rawProfile) {
        setNotFound(true)
        return
      }
      const [employerData, membersData, skillsData, assignments] = await Promise.all([
        getEmployer(rawProfile.employerId),
        listEmployerMembers(rawProfile.employerId),
        listLibrarySkills(),
        listEmployerRoleAssignments(roleProfileId),
      ])
      const coursesData = await listEmployerCatalogueCourses(employerData.provider_organisation_id)
      const memberByUserId = new Map(membersData.map((m) => [m.user_id, m]))
      setProfile(toRoleProfileViewModel(rawProfile, assignments, memberByUserId))
      setEmployer(employerData)
      setMembers(membersData)
      setAvailableSkills(skillsData)
      setAvailableCourses(coursesData.map((c) => ({ id: c.id, title: c.name })))
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
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function handleSaveDetails(values) {
    mutate(() => updateEmployerRoleProfile(roleProfileId, values))
  }

  function handleAddSkill({ skillId, targetLevel }) {
    const skill = availableSkills.find((s) => s.id === skillId)
    if (!skill) return
    mutate(() => replaceEmployerRoleSkillRequirements(roleProfileId, [...profile.requiredSkills, {
      skillId,
      name: skill.name,
      targetLevel,
      isComposite: skill.isComposite,
      componentCount: skill.componentCount,
    }]))
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

  function handleAssignEmployee(email) {
    mutate(async () => {
      const normalizedEmail = email.trim().toLowerCase()
      const member = members.find((m) => m.email?.trim().toLowerCase() === normalizedEmail && m.status === 'active')
      if (!member) throw new Error('Choose an active learner from this employer using their account email.')
      await assignEmployerRoleProfile(roleProfileId, member.id)
    })
  }

  function handleWithdrawAssignment(assignmentId) {
    mutate(() => withdrawEmployerRoleAssignment(assignmentId))
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
          to={employer ? `/employer?employer=${employer.id}&section=roles` : '/employer'}
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
                <RoleProfileDetailsForm roleProfile={profile} saving={saving} onSave={handleSaveDetails} />

                <div className="flex items-center gap-1 border-b border-hairline">
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
                    requiredSkills={profile.requiredSkills}
                    availableSkills={availableSkills}
                    saving={saving}
                    onAddSkill={handleAddSkill}
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
                    assigning={saving}
                    onAssignEmployee={handleAssignEmployee}
                    onWithdrawAssignment={handleWithdrawAssignment}
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
