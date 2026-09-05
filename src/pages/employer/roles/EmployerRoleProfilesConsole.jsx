import { useEffect, useRef, useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import RoleProfileList from './RoleProfileList'
import RoleProfileDetailsForm from './RoleProfileDetailsForm'
import RoleProfileSkillsPanel from './RoleProfileSkillsPanel'
import RoleProfileTrainingPanel from './RoleProfileTrainingPanel'
import RoleProfileLinkedEmployeesPanel from './RoleProfileLinkedEmployeesPanel'
import {
  FIXTURE_ROLE_PROFILES,
  FIXTURE_SKILL_CATALOGUE,
  FIXTURE_COURSE_CATALOGUE,
  FIXTURE_LINKED_EMPLOYEES,
} from './roleProfileFixtures'

// Genuinely props-in/callbacks-out: this composes the leaf panels below but
// owns no business data of its own -- no role profile, skill, training or
// assignment ever lives in local state here. Every mutation (save details,
// add/update/remove a skill or training item, assign/withdraw an employee)
// is relayed upward as a callback carrying the *next* value the caller
// should persist; the UI only ever reflects what comes back down through
// `roleProfiles`/`linkedEmployees` on the next render. The only local state
// is `creating`, a purely presentational toggle for whether the "new role
// profile" form is open -- it holds no role-profile data itself.
//
// The FIXTURE_* imports are optional default prop values for an isolated
// render only (e.g. opening this file's own preview) -- they are never
// substituted back in after a real callback fires, and a caller that wires
// real data is expected to override every prop.
export default function EmployerRoleProfilesConsole({
  roleProfiles = FIXTURE_ROLE_PROFILES,
  selectedRoleProfileId = null,
  availableSkills = FIXTURE_SKILL_CATALOGUE,
  availableCourses = FIXTURE_COURSE_CATALOGUE,
  linkedEmployees = FIXTURE_LINKED_EMPLOYEES,
  loading = false,
  error = null,
  onSelectRoleProfile,
  onSaveRoleProfile,
  onReplaceSkills,
  onReplaceTraining,
  onAssignEmployee,
  onWithdrawAssignment,
}) {
  const [creating, setCreating] = useState(false)
  const wasLoading = useRef(loading)

  // Same "caller owns the async lifecycle" contract as ManagerTeamSharingPanel:
  // the create form only closes once `loading` transitions back to false with
  // no `error` -- a failed create leaves it open with the error still visible
  // instead of closing prematurely on submit.
  useEffect(() => {
    if (wasLoading.current && !loading && !error) {
      setCreating(false)
    }
    wasLoading.current = loading
  }, [loading, error])

  const selected = roleProfiles.find((p) => p.id === selectedRoleProfileId) ?? null
  const requiredSkills = selected?.requiredSkills ?? []
  const training = selected?.training ?? []

  function handleSelect(id) {
    setCreating(false)
    onSelectRoleProfile?.(id)
  }

  function handleSaveDetails({ name, description }) {
    onSaveRoleProfile?.(creating ? null : selectedRoleProfileId, { name, description })
  }

  function handleAddSkill({ skillId, targetLevel }) {
    if (!selectedRoleProfileId) return
    const skill = availableSkills.find((s) => s.id === skillId)
    if (!skill) return
    onReplaceSkills?.(selectedRoleProfileId, [...requiredSkills, {
      skillId,
      name: skill.name,
      targetLevel,
      isComposite: skill.isComposite,
      componentCount: skill.componentCount,
    }])
  }

  function handleUpdateTargetLevel(skillId, targetLevel) {
    if (!selectedRoleProfileId) return
    onReplaceSkills?.(
      selectedRoleProfileId,
      requiredSkills.map((s) => (s.skillId === skillId ? { ...s, targetLevel } : s))
    )
  }

  function handleRemoveSkill(skillId) {
    if (!selectedRoleProfileId) return
    onReplaceSkills?.(
      selectedRoleProfileId,
      requiredSkills.filter((s) => s.skillId !== skillId)
    )
  }

  function handleAddTraining({ courseId, requirement }) {
    if (!selectedRoleProfileId) return
    const course = availableCourses.find((c) => c.id === courseId)
    if (!course) return
    onReplaceTraining?.(selectedRoleProfileId, [...training, { courseId, title: course.title, requirement }])
  }

  function handleUpdateRequirement(courseId, requirement) {
    if (!selectedRoleProfileId) return
    onReplaceTraining?.(
      selectedRoleProfileId,
      training.map((t) => (t.courseId === courseId ? { ...t, requirement } : t))
    )
  }

  function handleRemoveTraining(courseId) {
    if (!selectedRoleProfileId) return
    onReplaceTraining?.(
      selectedRoleProfileId,
      training.filter((t) => t.courseId !== courseId)
    )
  }

  function handleAssignEmployee(email) {
    if (!selectedRoleProfileId) return
    onAssignEmployee?.(selectedRoleProfileId, email)
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
      <RoleProfileList
        roleProfiles={roleProfiles}
        selectedId={selectedRoleProfileId}
        loading={loading && roleProfiles.length === 0}
        onSelect={handleSelect}
        onCreate={() => setCreating(true)}
      />

      <div className="space-y-6">
        {/* One shared banner for whichever action last failed, rather than
            repeating the same message (and role="alert") across every leaf
            panel below -- the single flat `error` prop doesn't say which
            action it belongs to, so it's surfaced once, clearly, here. */}
        <MutationFeedback status="error" message={error} />

        {creating && (
          <RoleProfileDetailsForm saving={loading} onSave={handleSaveDetails} onCancel={() => setCreating(false)} />
        )}

        {!creating && selected && (
          <>
            <RoleProfileDetailsForm roleProfile={selected} saving={loading} onSave={handleSaveDetails} />
            <RoleProfileSkillsPanel
              requiredSkills={requiredSkills}
              availableSkills={availableSkills}
              saving={loading}
              onAddSkill={handleAddSkill}
              onUpdateTargetLevel={handleUpdateTargetLevel}
              onRemoveSkill={handleRemoveSkill}
            />
            <RoleProfileTrainingPanel
              training={training}
              availableCourses={availableCourses}
              saving={loading}
              onAddTraining={handleAddTraining}
              onUpdateRequirement={handleUpdateRequirement}
              onRemoveTraining={handleRemoveTraining}
            />
            <RoleProfileLinkedEmployeesPanel
              employees={linkedEmployees}
              assigning={loading}
              onAssignEmployee={handleAssignEmployee}
              onWithdrawAssignment={onWithdrawAssignment}
            />
          </>
        )}

        {!creating && !selected && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <p className="text-sm text-secondary">Select a role profile, or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  )
}
