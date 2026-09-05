import { useEffect, useMemo, useRef, useState } from 'react'
import MutationFeedback from '../../../components/MutationFeedback'
import RoleProfileList from './RoleProfileList'
import RoleProfileDetailsForm from './RoleProfileDetailsForm'
import RoleProfileSkillsPanel from './RoleProfileSkillsPanel'
import RoleProfileTrainingPanel from './RoleProfileTrainingPanel'
import RoleProfileLinkedEmployeesPanel from './RoleProfileLinkedEmployeesPanel'
import { useSortedPage, useUrlParam, writeUrlParams } from '../../../lib/useSortedPage'
import {
  FIXTURE_ROLE_PROFILES,
  FIXTURE_SKILL_CATALOGUE,
  FIXTURE_COURSE_CATALOGUE,
  FIXTURE_LINKED_EMPLOYEES,
} from './roleProfileFixtures'

// Inert stand-ins for searchParams/setSearchParams so the search/sort/page
// hooks below can always be called unconditionally (rules of hooks) even
// when this renders without a real router-backed pair -- same reason the
// other props above default to FIXTURE_* -- letting
// EmployerRoleProfilesConsole.test.jsx keep rendering this with no
// searchParams/setSearchParams at all (it falls back to page-1/no-filter,
// same as every other list here does before a user interacts with it).
const EMPTY_SEARCH_PARAMS = new URLSearchParams()
function noopSetSearchParams() {}

const ROLE_PROFILE_SORT_ACCESSORS = {
  name: (p) => p.name?.toLowerCase() ?? '',
  updatedAt: (p) => p.updatedAt ?? '',
}

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
  searchParams = EMPTY_SEARCH_PARAMS,
  setSearchParams = noopSetSearchParams,
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

  // Looked up from the full, unfiltered roleProfiles -- the detail panel
  // stays on whatever was selected even if a search subsequently typed into
  // the list below no longer matches it, rather than going blank.
  const selected = roleProfiles.find((p) => p.id === selectedRoleProfileId) ?? null
  const requiredSkills = selected?.requiredSkills ?? []
  const training = selected?.training ?? []

  // The list on the left is this section's own primary roster -- searchable
  // and paginated the same way every other console list here is (Users,
  // Providers, ...), just rendered as RoleProfileList's cards instead of a
  // <table> since a role profile's summary doesn't decompose into sortable
  // columns the way a user/course/provider row does.
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const q = query.trim().toLowerCase()
  const filteredProfiles = useMemo(
    () =>
      q
        ? roleProfiles.filter((p) => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
        : roleProfiles,
    [roleProfiles, q]
  )
  const filtersActive = query !== ''

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { page, setPage, pageSize, setPageSize, pageItems, totalItems } = useSortedPage(
    filteredProfiles,
    ROLE_PROFILE_SORT_ACCESSORS,
    { defaultSortKey: 'name', urlSync: { searchParams, setSearchParams } }
  )

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
        roleProfiles={pageItems}
        hasAnyRoleProfiles={roleProfiles.length > 0}
        selectedId={selectedRoleProfileId}
        loading={loading && roleProfiles.length === 0}
        onSelect={handleSelect}
        onCreate={() => setCreating(true)}
        query={query}
        onQueryChange={setQuery}
        filtersActive={filtersActive}
        onResetFilters={resetFilters}
        page={page}
        setPage={setPage}
        pageSize={pageSize}
        setPageSize={setPageSize}
        totalItems={totalItems}
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
