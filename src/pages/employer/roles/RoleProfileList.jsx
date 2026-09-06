import { formatAbsoluteDate } from '../../../lib/dates'
import { SortableTh, TablePagination } from '../../../components/TableControls'

// Employer-facing table of this organisation's generic role profiles --
// full page width, one row per profile, matching the same searchable/
// sortable/paginated <table> convention as every other console list here
// (Users, Providers, Platform admin's own tables). Clicking a row's name
// opens that profile's own detail page (EmployerRoleProfileDetail.jsx, via
// onOpenProfile) -- its own Skills/Courses/Users tabs are where a profile's
// required skills, training and linked employees are actually managed, not
// this table. Stays a plain callback rather than a real <Link> so this
// component (and its own tests) never need a Router in scope -- the actual
// navigation happens one level up, in EmployerConsole.jsx, which always
// renders inside one. `roleProfiles` here is already the current page's
// slice (EmployerRoleProfilesConsole computes it); `hasAnyRoleProfiles`
// distinguishes an actually-empty roster from a search that just matched
// nothing on it.
export default function RoleProfileList({
  roleProfiles,
  hasAnyRoleProfiles = roleProfiles.length > 0,
  loading = false,
  error = null,
  onCreate,
  onOpenProfile,
  query = '',
  onQueryChange,
  filtersActive = false,
  onResetFilters,
  sortKey = null,
  sortDir = 'asc',
  onSort,
  page = 1,
  setPage,
  pageSize = 20,
  setPageSize,
  totalItems = roleProfiles.length,
}) {
  return (
    <section aria-labelledby="employer-role-profiles-heading">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <h2 id="employer-role-profiles-heading" className="font-display text-lg text-ink">Role profiles</h2>
          <p className="text-sm text-secondary mt-1 max-w-2xl">
            Define the skills, courses and linked employees expected for a role. Open one to manage each from its
            own page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onCreate?.()}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 whitespace-nowrap"
        >
          New role profile
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 mb-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-secondary">Loading…</p>
      ) : !hasAnyRoleProfiles ? (
        <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No role profiles yet. Create one to define required skills and training for a role.</p>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-lg">
          <div className="flex flex-wrap items-center gap-2 p-3">
            <input
              aria-label="Search role profiles"
              type="text"
              value={query}
              onChange={(e) => onQueryChange?.(e.target.value)}
              placeholder="Search by name or description…"
              className="flex-1 min-w-[220px] rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
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

          {roleProfiles.length === 0 ? (
            <p className="text-center text-xs text-secondary py-8">No role profiles match your search.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-secondary">
                      <SortableTh label="Name" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                      <th className="px-4 py-2 font-medium">Description</th>
                      <SortableTh label="Skills" columnKey="skills" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
                      <SortableTh label="Courses" columnKey="training" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
                      <SortableTh label="Users" columnKey="employees" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
                      <SortableTh label="Updated" columnKey="updatedAt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody>
                    {roleProfiles.map((profile) => (
                      <tr key={profile.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onOpenProfile?.(profile.id)}
                            className="text-xs font-medium text-moss hover:underline text-left truncate max-w-[200px]"
                            title={profile.name}
                          >
                            {profile.name}
                          </button>
                        </td>
                        <td className="px-4 py-2 text-secondary truncate max-w-xs" title={profile.description || ''}>
                          {profile.description || '—'}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">{profile.requiredSkills.length}</td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">{profile.training.length}</td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">{profile.linkedEmployeeCount}</td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {profile.updatedAt ? formatAbsoluteDate(profile.updatedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
      )}
    </section>
  )
}
