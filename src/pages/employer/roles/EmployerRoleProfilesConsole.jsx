import { useEffect, useMemo, useRef, useState } from 'react'
import AccessibleDialog from '../../../components/AccessibleDialog'
import ConfirmDialog from '../../../components/ConfirmDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import { BulkActionBar } from '../../../components/TableControls'
import RoleProfileList from './RoleProfileList'
import RoleProfileDetailsForm from './RoleProfileDetailsForm'
import AssignRoleProfilesDialog from './AssignRoleProfilesDialog'
import { useRowSelection, useSortedPage, useUrlParam, writeUrlParams } from '../../../lib/useSortedPage'
import { canDeleteRoleProfile, isRoleProfileActive } from '../../../lib/employerRoleProfiles'
import { FIXTURE_ROLE_PROFILES } from './roleProfileFixtures'

// Inert stand-ins for searchParams/setSearchParams so the search/sort/page
// hooks below can always be called unconditionally (rules of hooks) even
// when this renders without a real router-backed pair -- same reason
// roleProfiles defaults to FIXTURE_ROLE_PROFILES -- letting
// EmployerRoleProfilesConsole.test.jsx keep rendering this with no
// searchParams/setSearchParams at all (it falls back to page-1/no-filter,
// same as every other list here does before a user interacts with it).
const EMPTY_SEARCH_PARAMS = new URLSearchParams()
function noopSetSearchParams() {}

const ROLE_PROFILE_SORT_ACCESSORS = {
  name: (p) => p.name?.toLowerCase() ?? '',
  status: (p) => (isRoleProfileActive(p) ? 0 : 1),
  updatedAt: (p) => p.updatedAt ?? '',
  skills: (p) => p.requiredSkills?.length ?? 0,
  training: (p) => p.training?.length ?? 0,
  employees: (p) => p.linkedEmployeeCount ?? 0,
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// The full-width table plus its bulk actions -- a row's own required skills,
// training and linked employees are each managed on that role profile's own
// detail page (EmployerRoleProfileDetail.jsx, reached via onOpenProfile).
// Bulk actions on the selected rows: assign to employees (proposes each
// role; active roles only), deactivate/reactivate, and delete (only for
// roles nobody is proposed or linked to -- deactivate those instead).
// Creating a new (empty) profile hands off to its detail page, the same way
// ProviderConsole's own "+ Create training" flow does.
export default function EmployerRoleProfilesConsole({
  roleProfiles = FIXTURE_ROLE_PROFILES,
  members = [],
  loading = false,
  error = null,
  searchParams = EMPTY_SEARCH_PARAMS,
  setSearchParams = noopSetSearchParams,
  onCreateRoleProfile,
  onOpenProfile,
  onAssignRoleProfiles,
  onSetRoleProfilesStatus,
  onDeleteRoleProfiles,
}) {
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [bulkDialog, setBulkDialog] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkFeedback, setBulkFeedback] = useState(null)
  const wasLoading = useRef(loading)

  // Falls back to just closing if onCreateRoleProfile doesn't hand back an
  // id (e.g. it failed -- the caller's own `error` prop already surfaces
  // why, via createError below) or there's nowhere to navigate to (no
  // onOpenProfile wired, as in an isolated render/test).
  async function handleCreate(values) {
    setSaving(true)
    setCreateError(null)
    try {
      const id = await onCreateRoleProfile?.(values)
      setCreating(false)
      if (id) onOpenProfile?.(id)
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Belt-and-braces close: if the caller's own loading prop transitions
  // back to done with no error while the create dialog is open (e.g.
  // onCreateRoleProfile resolved but didn't itself throw or return an id),
  // don't leave the dialog stuck open.
  useEffect(() => {
    if (wasLoading.current && !loading && !error && creating) {
      setCreating(false)
    }
    wasLoading.current = loading
  }, [loading, error, creating])

  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const [statusFilter, setStatusFilter] = useUrlParam(searchParams, setSearchParams, 'status', 'all', { resetParams: ['page'] })
  const q = query.trim().toLowerCase()
  const filteredProfiles = useMemo(
    () =>
      roleProfiles.filter((p) => {
        if (statusFilter === 'active' && !isRoleProfileActive(p)) return false
        if (statusFilter === 'archived' && isRoleProfileActive(p)) return false
        return !q || p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
      }),
    [roleProfiles, q, statusFilter]
  )
  const filtersActive = query !== '' || statusFilter !== 'all'

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, status: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } = useSortedPage(
    filteredProfiles,
    ROLE_PROFILE_SORT_ACCESSORS,
    { defaultSortKey: 'name', urlSync: { searchParams, setSearchParams } }
  )

  const selection = useRowSelection(filteredProfiles.map((p) => p.id))
  const selectedProfiles = filteredProfiles.filter((p) => selection.selected.has(p.id))
  const activeSelected = selectedProfiles.filter(isRoleProfileActive)
  const inactiveSelected = selectedProfiles.filter((p) => !isRoleProfileActive(p))
  const undeletable = selectedProfiles.filter((p) => !canDeleteRoleProfile(p))

  async function runBulk(action, successMessage) {
    setBulkBusy(true)
    setBulkFeedback(null)
    try {
      const result = await action()
      selection.clear()
      setBulkDialog(null)
      setBulkFeedback({ status: 'success', message: typeof successMessage === 'function' ? successMessage(result) : successMessage })
    } catch (err) {
      setBulkDialog(null)
      setBulkFeedback({ status: 'error', message: err.message })
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleAssign(memberIds, dates) {
    const profiles = activeSelected
    const result = await onAssignRoleProfiles?.(profiles.map((p) => p.id), memberIds, dates)
    selection.clear()
    setBulkDialog(null)
    const proposed = result?.proposed ?? 0
    const skipped = result?.skipped ?? 0
    setBulkFeedback({
      status: 'success',
      message: `Proposed ${plural(proposed, 'role assignment')}.${skipped ? ` Skipped ${skipped} that already existed or couldn't be proposed.` : ''}`,
    })
  }

  const bulkActions = [
    {
      label: 'Assign to employees',
      onClick: () => setBulkDialog('assign'),
      disabled: activeSelected.length === 0,
      title: activeSelected.length === 0 ? 'Inactive role profiles can’t be assigned' : undefined,
    },
    ...(activeSelected.length > 0
      ? [{ label: 'Deactivate', onClick: () => setBulkDialog('deactivate') }]
      : []),
    ...(inactiveSelected.length > 0
      ? [{
          label: 'Reactivate',
          onClick: () => runBulk(
            () => onSetRoleProfilesStatus?.(inactiveSelected.map((p) => p.id), 'active'),
            `Reactivated ${plural(inactiveSelected.length, 'role profile')}.`
          ),
        }]
      : []),
    {
      label: 'Delete',
      variant: 'danger',
      onClick: () => setBulkDialog('delete'),
      disabled: undeletable.length > 0,
      title: undeletable.length > 0
        ? 'Role profiles with employees proposed or linked can’t be deleted — deactivate them instead'
        : undefined,
    },
  ]

  return (
    <div>
      {error && <MutationFeedback status="error" message={error} className="mb-4" />}
      {bulkFeedback && <MutationFeedback status={bulkFeedback.status} message={bulkFeedback.message} className="mb-4" />}

      <RoleProfileList
        roleProfiles={pageItems}
        hasAnyRoleProfiles={roleProfiles.length > 0}
        loading={loading && roleProfiles.length === 0}
        onCreate={() => setCreating(true)}
        onOpenProfile={onOpenProfile}
        query={query}
        onQueryChange={setQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
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
        selectedIds={selection.selected}
        onToggleSelected={selection.toggle}
        onToggleAllSelected={selection.toggleAll}
        bulkActionBar={
          <BulkActionBar
            count={selection.selected.size}
            onClear={selection.clear}
            actions={bulkActions}
            busy={bulkBusy}
          />
        }
      />

      {creating && (
        <AccessibleDialog
          label="New role profile"
          onClose={saving ? undefined : () => setCreating(false)}
          closeOnBackdrop={!saving}
          panelClassName="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain"
        >
          <RoleProfileDetailsForm
            saving={saving}
            error={createError}
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </AccessibleDialog>
      )}

      {bulkDialog === 'assign' && (
        <AssignRoleProfilesDialog
          roleProfiles={activeSelected}
          members={members}
          onAssign={handleAssign}
          onClose={() => setBulkDialog(null)}
        />
      )}

      {bulkDialog === 'deactivate' && (
        <ConfirmDialog
          message={`Deactivate ${plural(activeSelected.length, 'role profile')}? They can't be assigned to anyone new, but people already linked keep them. You can reactivate them later.`}
          confirmLabel="Deactivate"
          confirming={bulkBusy}
          onCancel={() => setBulkDialog(null)}
          onConfirm={() => runBulk(
            () => onSetRoleProfilesStatus?.(activeSelected.map((p) => p.id), 'archived'),
            `Deactivated ${plural(activeSelected.length, 'role profile')}.`
          )}
        />
      )}

      {bulkDialog === 'delete' && (
        <ConfirmDialog
          message={`Permanently delete ${plural(selectedProfiles.length, 'role profile')}, including their required skills and courses? This can't be undone. Employees' own records aren't affected.`}
          confirmLabel="Delete"
          confirming={bulkBusy}
          onCancel={() => setBulkDialog(null)}
          onConfirm={() => runBulk(
            () => onDeleteRoleProfiles?.(selectedProfiles.map((p) => p.id)),
            `Deleted ${plural(selectedProfiles.length, 'role profile')}.`
          )}
        />
      )}
    </div>
  )
}
