import { formatAbsoluteDate } from '../../../lib/dates'
import { TablePagination } from '../../../components/TableControls'

// Employer-facing list of this organisation's generic role profiles --
// deliberately name/description/summary-counts only here; a role profile's
// required skills, training and linked employees are edited on its own
// panel once selected (see RoleProfileSkillsPanel etc.), not inline here.
// Skill/training counts are derived from the profile's own requiredSkills/
// training arrays rather than a separate count field, so there's one
// source of truth for "how many" instead of a number that could drift from
// the actual list; linkedEmployeeCount stays a summary-only field since the
// full per-employee list is only ever fetched for the selected profile.
//
// Search box + "Reset filters" + TablePagination mirror every other
// console list's own roster (Users, Providers, ...) -- rendered as cards
// rather than a <table> since a role profile's summary doesn't decompose
// into sortable columns the way a user/course/provider row does, but
// otherwise the same filterable/paginated shape. `roleProfiles` here is
// already the current page's slice (EmployerRoleProfilesConsole computes
// it); `hasAnyRoleProfiles` distinguishes an actually-empty roster from a
// search that just matched nothing on it.
export default function RoleProfileList({
  roleProfiles,
  hasAnyRoleProfiles = roleProfiles.length > 0,
  selectedId = null,
  loading = false,
  error = null,
  onSelect,
  onCreate,
  query = '',
  onQueryChange,
  filtersActive = false,
  onResetFilters,
  page = 1,
  setPage,
  pageSize = 20,
  setPageSize,
  totalItems = roleProfiles.length,
}) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg text-ink">Role profiles</h2>
        <button
          type="button"
          onClick={() => onCreate?.()}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 whitespace-nowrap"
        >
          New role profile
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 mb-2">
          {error}
        </p>
      )}

      {hasAnyRoleProfiles && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            aria-label="Search role profiles"
            type="text"
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
            placeholder="Search by name…"
            className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
          {filtersActive && (
            <button
              type="button"
              onClick={() => onResetFilters?.()}
              className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {loading && <p className="text-sm text-secondary">Loading…</p>}

      {!loading && !hasAnyRoleProfiles && (
        <p className="text-sm text-secondary py-2">
          No role profiles yet. Create one to define required skills and training for a role.
        </p>
      )}

      {!loading && hasAnyRoleProfiles && roleProfiles.length === 0 && (
        <p className="text-sm text-secondary py-2">No role profiles match your search.</p>
      )}

      {!loading && roleProfiles.length > 0 && (
        <>
          <ul className="divide-y divide-hairline">
            {roleProfiles.map((profile) => {
              const isSelected = profile.id === selectedId
              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(profile.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`w-full text-left py-3 px-2 -mx-2 rounded-md hover:bg-paper ${
                      isSelected ? 'bg-paper' : ''
                    }`}
                  >
                    <p className="text-sm font-medium text-ink">{profile.name}</p>
                    {profile.description && <p className="text-sm text-secondary mt-0.5">{profile.description}</p>}
                    <p className="text-xs text-secondary mt-1">
                      {profile.requiredSkills.length} skill{profile.requiredSkills.length === 1 ? '' : 's'} ·{' '}
                      {profile.training.length} training item{profile.training.length === 1 ? '' : 's'} ·{' '}
                      {profile.linkedEmployeeCount} employee{profile.linkedEmployeeCount === 1 ? '' : 's'} linked
                      {profile.updatedAt && <> · updated {formatAbsoluteDate(profile.updatedAt)}</>}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
          <TablePagination
            page={page}
            setPage={setPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            totalItems={totalItems}
            idPrefix="employer-role-profiles"
          />
        </>
      )}
    </div>
  )
}
