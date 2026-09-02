import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { listEmployers, createEmployer } from '../../lib/admin/employers'
import { listOrganisations } from '../../lib/admin/organisations'
import { useSortedPage } from '../../lib/useSortedPage'
import { SortableTh, TablePagination } from '../../components/TableControls'

const EMPLOYER_SORT_ACCESSORS = {
  name: (e) => e.name?.toLowerCase() ?? '',
  employer_code: (e) => e.employer_code?.toLowerCase() ?? '',
  created_at: (e) => e.created_at ?? '',
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

// Phase 1 foundation console for the "employer" domain concept
// (20260902090000): a company running its own in-house LMS, distinct from
// "organisations" (today, only ever training providers). Mirrors
// AdminProviders.jsx's list/create shape -- platform-admin only, list plus a
// simple create-by-name form. create_employer atomically provisions the
// employer's own attached provider organisation, which is what the linked
// "Manage in Providers" column below points at -- staffing that provider org
// (who can author training there) still goes through the existing
// AdminProviders "Manage users" panel, unchanged by this feature.
export default function AdminEmployers() {
  const [employers, setEmployers] = useState([])
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(employers, EMPLOYER_SORT_ACCESSORS)

  const organisationById = useMemo(() => new Map(organisations.map((o) => [o.id, o])), [organisations])

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [employerList, organisationList] = await Promise.all([listEmployers(), listOrganisations()])
      setEmployers(employerList)
      setOrganisations(organisationList)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      await createEmployer(newName)
      setNewName('')
      setShowCreateForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Employers</h2>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
          >
            {showCreateForm ? 'Cancel' : '+ Create employer'}
          </button>
        </div>

        {showCreateForm && (
          <form
            onSubmit={handleCreate}
            className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[220px]">
              <label className="block text-sm text-secondary mb-1" htmlFor="employerName">
                Employer name
              </label>
              <input
                id="employerName"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Employer name…"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        )}
        <p className="text-xs text-secondary -mt-3">
          Creating an employer also provisions its own attached provider organisation, so it can author its own
          training through the provider console. Add the employer's own staff to that organisation from Providers →
          Manage users.
        </p>

        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : employers.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No employers yet.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SortableTh label="ID" columnKey="employer_code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Employer" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Created" columnKey="created_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <th className="px-4 py-2 font-medium">Attached provider organisation</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((employer) => {
                    const org = organisationById.get(employer.provider_organisation_id)
                    return (
                      <tr key={employer.id} className="border-b border-hairline last:border-0">
                        <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{employer.employer_code}</td>
                        <td className="px-4 py-3 text-ink font-medium whitespace-nowrap">{employer.name}</td>
                        <td className="px-4 py-3 text-secondary whitespace-nowrap">{formatDate(employer.created_at)}</td>
                        <td className="px-4 py-3">
                          <Link to="/admin/providers" className="text-xs font-medium text-moss hover:underline whitespace-nowrap">
                            {org ? `${org.name} (${org.org_code})` : 'View in Providers'} →
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="admin-employers" />
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
