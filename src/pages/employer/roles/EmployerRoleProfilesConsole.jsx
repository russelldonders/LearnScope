import { useEffect, useMemo, useRef, useState } from 'react'
import AccessibleDialog from '../../../components/AccessibleDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import RoleProfileList from './RoleProfileList'
import RoleProfileDetailsForm from './RoleProfileDetailsForm'
import { useSortedPage, useUrlParam, writeUrlParams } from '../../../lib/useSortedPage'
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
  updatedAt: (p) => p.updatedAt ?? '',
  skills: (p) => p.requiredSkills?.length ?? 0,
  training: (p) => p.training?.length ?? 0,
  employees: (p) => p.linkedEmployeeCount ?? 0,
}

// The full-width table only -- a row's own required skills, training and
// linked employees are each managed on that role profile's own detail page
// (EmployerRoleProfileDetail.jsx, reached via onOpenProfile), not here. The
// only mutation this component drives is creating a new (empty) profile,
// which then hands off to its detail page the same way ProviderConsole's
// own "+ Create training" flow creates a draft and navigates straight to
// its full editor rather than building it out inline.
export default function EmployerRoleProfilesConsole({
  roleProfiles = FIXTURE_ROLE_PROFILES,
  loading = false,
  error = null,
  searchParams = EMPTY_SEARCH_PARAMS,
  setSearchParams = noopSetSearchParams,
  onCreateRoleProfile,
  onOpenProfile,
}) {
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [saving, setSaving] = useState(false)
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

  return (
    <div>
      {error && <MutationFeedback status="error" message={error} className="mb-4" />}

      <RoleProfileList
        roleProfiles={pageItems}
        hasAnyRoleProfiles={roleProfiles.length > 0}
        loading={loading && roleProfiles.length === 0}
        onCreate={() => setCreating(true)}
        onOpenProfile={onOpenProfile}
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
    </div>
  )
}
