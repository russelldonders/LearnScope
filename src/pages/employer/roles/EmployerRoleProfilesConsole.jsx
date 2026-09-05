import { useEffect, useMemo, useRef, useState } from 'react'
import AccessibleDialog from '../../../components/AccessibleDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import RoleProfileList from './RoleProfileList'
import RoleProfileDetailsForm from './RoleProfileDetailsForm'
import RoleProfileSkillsPanel from './RoleProfileSkillsPanel'
import RoleProfileTrainingPanel from './RoleProfileTrainingPanel'
import RoleProfileLinkedEmployeesPanel from './RoleProfileLinkedEmployeesPanel'
import { useSortedPage, useUrlParam, writeUrlParams } from '../../../lib/useSortedPage'
import { FIXTURE_ROLE_PROFILES, FIXTURE_SKILL_CATALOGUE, FIXTURE_COURSE_CATALOGUE } from './roleProfileFixtures'

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
  skills: (p) => p.requiredSkills?.length ?? 0,
  training: (p) => p.training?.length ?? 0,
  employees: (p) => p.linkedEmployeeCount ?? 0,
}

// Genuinely props-in/callbacks-out: this composes the leaf panels below but
// owns no business data of its own -- no role profile, skill, training or
// assignment ever lives in local state here (each role profile's own
// requiredSkills/training/linkedEmployees already arrive fully formed via
// the `roleProfiles` prop -- see EmployerRoleProfilesSection's
// toConsoleProfile). Every mutation (save details, add/update/remove a
// skill or training item, assign/withdraw an employee) is relayed upward as
// a callback carrying the *next* value the caller should persist; the UI
// only ever reflects what comes back down through `roleProfiles` on the
// next render. The only local state is `modal` (which row's edit/skills/
// training/users dialog is open, if any) -- purely presentational, holds no
// role-profile data of its own.
//
// The FIXTURE_* imports are optional default prop values for an isolated
// render only (e.g. opening this file's own preview) -- they are never
// substituted back in after a real callback fires, and a caller that wires
// real data is expected to override every prop.
export default function EmployerRoleProfilesConsole({
  roleProfiles = FIXTURE_ROLE_PROFILES,
  availableSkills = FIXTURE_SKILL_CATALOGUE,
  availableCourses = FIXTURE_COURSE_CATALOGUE,
  loading = false,
  error = null,
  searchParams = EMPTY_SEARCH_PARAMS,
  setSearchParams = noopSetSearchParams,
  onSaveRoleProfile,
  onReplaceSkills,
  onReplaceTraining,
  onAssignEmployee,
  onWithdrawAssignment,
}) {
  // { type: 'edit' | 'skills' | 'training' | 'users', profileId: string | null }
  // profileId null only ever pairs with type 'edit' (the "New role profile"
  // create form) -- every other type always opens against an existing row.
  const [modal, setModal] = useState(null)
  const wasLoading = useRef(loading)

  // Same "caller owns the async lifecycle" contract as ManagerTeamSharingPanel:
  // the edit/create dialog only closes once `loading` transitions back to
  // false with no `error` -- a failed save leaves it open with the error
  // still visible instead of closing prematurely on submit. The
  // skills/training/users dialogs deliberately don't auto-close the same
  // way -- they're a running editor a manager builds up over several add/
  // remove actions in one sitting, not a single submit-and-done form.
  useEffect(() => {
    if (wasLoading.current && !loading && !error && modal?.type === 'edit') {
      setModal(null)
    }
    wasLoading.current = loading
  }, [loading, error, modal])

  // Looked up from the full, unfiltered roleProfiles -- an open dialog stays
  // on whatever row opened it even if a search subsequently typed into the
  // table below no longer matches it, rather than going blank.
  const modalProfile = modal ? roleProfiles.find((p) => p.id === modal.profileId) ?? null : null
  const requiredSkills = modalProfile?.requiredSkills ?? []
  const training = modalProfile?.training ?? []
  const linkedEmployees = modalProfile?.linkedEmployees ?? []

  // This section's own primary roster -- searchable, sortable and paginated
  // the same way every other console list here is (Users, Providers, ...).
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

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } = useSortedPage(
    filteredProfiles,
    ROLE_PROFILE_SORT_ACCESSORS,
    { defaultSortKey: 'name', urlSync: { searchParams, setSearchParams } }
  )

  function closeModal() {
    setModal(null)
  }

  function handleSaveDetails({ name, description }) {
    onSaveRoleProfile?.(modal?.profileId ?? null, { name, description })
  }

  function handleAddSkill({ skillId, targetLevel }) {
    if (!modal?.profileId) return
    const skill = availableSkills.find((s) => s.id === skillId)
    if (!skill) return
    onReplaceSkills?.(modal.profileId, [...requiredSkills, {
      skillId,
      name: skill.name,
      targetLevel,
      isComposite: skill.isComposite,
      componentCount: skill.componentCount,
    }])
  }

  function handleUpdateTargetLevel(skillId, targetLevel) {
    if (!modal?.profileId) return
    onReplaceSkills?.(
      modal.profileId,
      requiredSkills.map((s) => (s.skillId === skillId ? { ...s, targetLevel } : s))
    )
  }

  function handleRemoveSkill(skillId) {
    if (!modal?.profileId) return
    onReplaceSkills?.(
      modal.profileId,
      requiredSkills.filter((s) => s.skillId !== skillId)
    )
  }

  function handleAddTraining({ courseId, requirement }) {
    if (!modal?.profileId) return
    const course = availableCourses.find((c) => c.id === courseId)
    if (!course) return
    onReplaceTraining?.(modal.profileId, [...training, { courseId, title: course.title, requirement }])
  }

  function handleUpdateRequirement(courseId, requirement) {
    if (!modal?.profileId) return
    onReplaceTraining?.(
      modal.profileId,
      training.map((t) => (t.courseId === courseId ? { ...t, requirement } : t))
    )
  }

  function handleRemoveTraining(courseId) {
    if (!modal?.profileId) return
    onReplaceTraining?.(
      modal.profileId,
      training.filter((t) => t.courseId !== courseId)
    )
  }

  function handleAssignEmployee(email) {
    if (!modal?.profileId) return
    onAssignEmployee?.(modal.profileId, email)
  }

  return (
    <div>
      {/* One shared banner for whichever load (not save/mutation -- those
          surface inside their own open dialog below) last failed. */}
      {error && !modal && <MutationFeedback status="error" message={error} className="mb-4" />}

      <RoleProfileList
        roleProfiles={pageItems}
        hasAnyRoleProfiles={roleProfiles.length > 0}
        loading={loading && roleProfiles.length === 0}
        onCreate={() => setModal({ type: 'edit', profileId: null })}
        onEdit={(id) => setModal({ type: 'edit', profileId: id })}
        onAssignSkills={(id) => setModal({ type: 'skills', profileId: id })}
        onAssignTraining={(id) => setModal({ type: 'training', profileId: id })}
        onAssignUsers={(id) => setModal({ type: 'users', profileId: id })}
        query={query}
        onQueryChange={setQuery}
        filtersActive={filtersActive}
        onResetFilters={resetFilters}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={toggleSort}
        page={page}
        setPage={setPage}
        pageSize={pageSize}
        setPageSize={setPageSize}
        totalItems={totalItems}
      />

      {modal?.type === 'edit' && (
        <AccessibleDialog
          label={modalProfile ? `Edit ${modalProfile.name}` : 'New role profile'}
          onClose={loading ? undefined : closeModal}
          closeOnBackdrop={!loading}
          panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain"
        >
          <RoleProfileDetailsForm
            roleProfile={modalProfile}
            saving={loading}
            error={error}
            onSave={handleSaveDetails}
            onCancel={closeModal}
          />
        </AccessibleDialog>
      )}

      {modal?.type === 'skills' && modalProfile && (
        <AccessibleDialog
          label={`Assign skills -- ${modalProfile.name}`}
          onClose={closeModal}
          panelClassName="w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain space-y-3"
        >
          <RoleProfileSkillsPanel
            requiredSkills={requiredSkills}
            availableSkills={availableSkills}
            saving={loading}
            error={error}
            onAddSkill={handleAddSkill}
            onUpdateTargetLevel={handleUpdateTargetLevel}
            onRemoveSkill={handleRemoveSkill}
          />
          <div className="bg-card border border-hairline rounded-lg p-3 flex justify-end">
            <button type="button" onClick={closeModal} className="rounded-md border border-hairline text-ink py-1.5 px-4 text-sm font-medium hover:bg-paper">
              Close
            </button>
          </div>
        </AccessibleDialog>
      )}

      {modal?.type === 'training' && modalProfile && (
        <AccessibleDialog
          label={`Assign training -- ${modalProfile.name}`}
          onClose={closeModal}
          panelClassName="w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain space-y-3"
        >
          <RoleProfileTrainingPanel
            training={training}
            availableCourses={availableCourses}
            saving={loading}
            error={error}
            onAddTraining={handleAddTraining}
            onUpdateRequirement={handleUpdateRequirement}
            onRemoveTraining={handleRemoveTraining}
          />
          <div className="bg-card border border-hairline rounded-lg p-3 flex justify-end">
            <button type="button" onClick={closeModal} className="rounded-md border border-hairline text-ink py-1.5 px-4 text-sm font-medium hover:bg-paper">
              Close
            </button>
          </div>
        </AccessibleDialog>
      )}

      {modal?.type === 'users' && modalProfile && (
        <AccessibleDialog
          label={`Assign users -- ${modalProfile.name}`}
          onClose={closeModal}
          panelClassName="w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain space-y-3"
        >
          <RoleProfileLinkedEmployeesPanel
            employees={linkedEmployees}
            assigning={loading}
            error={error}
            onAssignEmployee={handleAssignEmployee}
            onWithdrawAssignment={onWithdrawAssignment}
          />
          <div className="bg-card border border-hairline rounded-lg p-3 flex justify-end">
            <button type="button" onClick={closeModal} className="rounded-md border border-hairline text-ink py-1.5 px-4 text-sm font-medium hover:bg-paper">
              Close
            </button>
          </div>
        </AccessibleDialog>
      )}
    </div>
  )
}
