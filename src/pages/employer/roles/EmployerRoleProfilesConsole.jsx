import { useState } from 'react'
import RoleProfileList from './RoleProfileList'
import RoleProfileDetailsForm from './RoleProfileDetailsForm'
import RoleProfileSkillsPanel from './RoleProfileSkillsPanel'
import RoleProfileTrainingPanel from './RoleProfileTrainingPanel'
import RoleProfileLinkedEmployeesPanel from './RoleProfileLinkedEmployeesPanel'
import {
  FIXTURE_ROLE_PROFILES,
  FIXTURE_SKILL_CATALOGUE,
  FIXTURE_COURSE_CATALOGUE,
  FIXTURE_REQUIRED_SKILLS,
  FIXTURE_TRAINING,
  FIXTURE_LINKED_EMPLOYEES,
} from './roleProfileFixtures'

let nextFixtureId = 100

// Self-contained fixture-backed demo of the employer role-profiles UI --
// composes the leaf panels above with local state standing in for the
// real employer-scoped API this will eventually call. Not wired into
// App.jsx/EmployerConsole.jsx; kept isolated per this phase's scope.
export default function EmployerRoleProfilesConsole({ initialRoleProfiles = FIXTURE_ROLE_PROFILES }) {
  const [roleProfiles, setRoleProfiles] = useState(initialRoleProfiles)
  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(false)

  // Fixture-only: the sample "Senior Support Engineer" profile starts with
  // populated skills/training/linked-employees data; any other profile
  // (including a freshly created one) starts empty, same as a real new
  // role profile would.
  const [requiredSkillsByProfile, setRequiredSkillsByProfile] = useState({
    'role-profile-1': FIXTURE_REQUIRED_SKILLS,
  })
  const [trainingByProfile, setTrainingByProfile] = useState({
    'role-profile-1': FIXTURE_TRAINING,
  })
  const [linkedEmployeesByProfile] = useState({
    'role-profile-1': FIXTURE_LINKED_EMPLOYEES,
  })

  const selected = roleProfiles.find((p) => p.id === selectedId) ?? null
  const requiredSkills = requiredSkillsByProfile[selectedId] ?? []
  const training = trainingByProfile[selectedId] ?? []
  const linkedEmployees = linkedEmployeesByProfile[selectedId] ?? []

  function handleCreate() {
    setCreating(true)
    setSelectedId(null)
  }

  function handleSaveDetails({ name, description }) {
    if (creating) {
      const id = `role-profile-${nextFixtureId++}`
      setRoleProfiles((prev) => [
        ...prev,
        {
          id,
          name,
          description,
          requiredSkillCount: 0,
          trainingCount: 0,
          linkedEmployeeCount: 0,
          updatedAt: new Date().toISOString().slice(0, 10),
        },
      ])
      setCreating(false)
      setSelectedId(id)
      return
    }
    setRoleProfiles((prev) => prev.map((p) => (p.id === selectedId ? { ...p, name, description } : p)))
  }

  function handleAddSkill({ skillId, targetLevel }) {
    const skill = FIXTURE_SKILL_CATALOGUE.find((s) => s.id === skillId)
    if (!skill) return
    setRequiredSkillsByProfile((prev) => {
      const next = [...(prev[selectedId] ?? []), { skillId, name: skill.name, targetLevel }]
      updateRoleProfileCount(selectedId, 'requiredSkillCount', next.length)
      return { ...prev, [selectedId]: next }
    })
  }

  function handleUpdateTargetLevel(skillId, targetLevel) {
    setRequiredSkillsByProfile((prev) => ({
      ...prev,
      [selectedId]: (prev[selectedId] ?? []).map((s) => (s.skillId === skillId ? { ...s, targetLevel } : s)),
    }))
  }

  function handleRemoveSkill(skillId) {
    setRequiredSkillsByProfile((prev) => {
      const next = (prev[selectedId] ?? []).filter((s) => s.skillId !== skillId)
      updateRoleProfileCount(selectedId, 'requiredSkillCount', next.length)
      return { ...prev, [selectedId]: next }
    })
  }

  function handleAddTraining({ courseId, requirement }) {
    const course = FIXTURE_COURSE_CATALOGUE.find((c) => c.id === courseId)
    if (!course) return
    setTrainingByProfile((prev) => {
      const next = [
        ...(prev[selectedId] ?? []),
        { id: `training-${nextFixtureId++}`, courseId, title: course.title, requirement },
      ]
      updateRoleProfileCount(selectedId, 'trainingCount', next.length)
      return { ...prev, [selectedId]: next }
    })
  }

  function handleUpdateRequirement(trainingId, requirement) {
    setTrainingByProfile((prev) => ({
      ...prev,
      [selectedId]: (prev[selectedId] ?? []).map((t) => (t.id === trainingId ? { ...t, requirement } : t)),
    }))
  }

  function handleRemoveTraining(trainingId) {
    setTrainingByProfile((prev) => {
      const next = (prev[selectedId] ?? []).filter((t) => t.id !== trainingId)
      updateRoleProfileCount(selectedId, 'trainingCount', next.length)
      return { ...prev, [selectedId]: next }
    })
  }

  function updateRoleProfileCount(profileId, countKey, count) {
    setRoleProfiles((prev) => prev.map((p) => (p.id === profileId ? { ...p, [countKey]: count } : p)))
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
      <RoleProfileList
        roleProfiles={roleProfiles}
        selectedId={selectedId}
        onSelect={(id) => {
          setCreating(false)
          setSelectedId(id)
        }}
        onCreate={handleCreate}
      />

      <div className="space-y-6">
        {creating && <RoleProfileDetailsForm onSave={handleSaveDetails} onCancel={() => setCreating(false)} />}

        {!creating && selected && (
          <>
            <RoleProfileDetailsForm roleProfile={selected} onSave={handleSaveDetails} />
            <RoleProfileSkillsPanel
              requiredSkills={requiredSkills}
              availableSkills={FIXTURE_SKILL_CATALOGUE}
              onAddSkill={handleAddSkill}
              onUpdateTargetLevel={handleUpdateTargetLevel}
              onRemoveSkill={handleRemoveSkill}
            />
            <RoleProfileTrainingPanel
              training={training}
              availableCourses={FIXTURE_COURSE_CATALOGUE}
              onAddTraining={handleAddTraining}
              onUpdateRequirement={handleUpdateRequirement}
              onRemoveTraining={handleRemoveTraining}
            />
            <RoleProfileLinkedEmployeesPanel employees={linkedEmployees} />
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
