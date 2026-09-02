import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AdminLayout from './AdminLayout'
import { listUsers, inviteUser, setUserBlocked, getUserLinkages, deleteUser } from '../../lib/admin/users'
import AccessibleDialog from '../../components/AccessibleDialog'
import StatusBadge from '../../components/StatusBadge'
import { useColumnPreferences, useSortedPage, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { ColumnCustomizer, SortableTh, TablePagination } from '../../components/TableControls'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'blocked', label: 'Blocked' },
]

const USER_SORT_ACCESSORS = {
  userCode: (u) => u.userCode?.toLowerCase() ?? '',
  fullName: (u) => u.fullName?.toLowerCase() ?? '',
  email: (u) => u.email?.toLowerCase() ?? '',
  accountStatus: (u) => u.accountStatus ?? '',
}

// Customizable data columns only -- the row-action buttons stay a fixed,
// unlabelled trailing column outside this list (see AdminUsers' own render
// below), so they can't be hidden or reordered.
const USER_COLUMNS = [
  {
    key: 'userCode',
    label: 'ID',
    sortable: true,
    cellClassName: 'px-4 py-2 text-secondary font-mono text-xs whitespace-nowrap',
    renderCell: (u) => u.userCode || '—',
  },
  {
    key: 'fullName',
    label: 'Name',
    sortable: true,
    cellClassName: 'px-4 py-2 text-ink whitespace-nowrap',
    renderCell: (u) => (
      <Link to={`/admin/users/${u.id}`} className="hover:text-moss hover:underline">
        {u.fullName || '—'}
      </Link>
    ),
  },
  {
    key: 'email',
    label: 'Email',
    sortable: true,
    cellClassName: 'px-4 py-2 text-ink',
    renderCell: (u) => (
      <Link to={`/admin/users/${u.id}`} className="hover:text-moss hover:underline">
        {u.email}
      </Link>
    ),
  },
  {
    key: 'accountStatus',
    label: 'Status',
    sortable: true,
    cellClassName: 'px-4 py-2',
    renderCell: (u) => (
      <StatusBadge label={u.accountStatus} tone={u.accountStatus === 'blocked' ? 'danger' : 'neutral'} />
    ),
  },
  {
    key: 'isPlatformAdmin',
    label: 'Platform admin',
    sortable: false,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2 text-secondary whitespace-nowrap',
    renderCell: (u) => (u.isPlatformAdmin ? 'Yes' : '—'),
  },
  {
    key: 'organisationMemberships',
    label: 'Organisations',
    sortable: false,
    cellClassName: 'px-4 py-2 text-secondary truncate max-w-xs',
    cellProps: (u) => ({ title: u.organisationMemberships.map((m) => `${m.organisationName} (${m.role})`).join(', ') }),
    renderCell: (u) =>
      u.organisationMemberships.length === 0
        ? '—'
        : u.organisationMemberships.map((m) => `${m.organisationName} (${m.role}${m.status === 'pending' ? ', pending' : ''})`).join(', '),
  },
]

export default function AdminUsers() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState(null)

  const [actioningId, setActioningId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  // Search text, status filter, sort, page and pageSize all live in the URL
  // together (?q=&status=&sort=&dir=&page=&pageSize=) via useSortedPage's
  // urlSync option and useUrlParam -- refresh, browser Back/Forward, and a
  // shared link all land on the same filtered/sorted/paged view. One
  // useSearchParams() call feeds both, matching the single-searchParams-call
  // convention ProviderConsole.jsx/ProviderCatalogueDetail.jsx already use
  // for their own ?org=&section=/?tab= state.
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const [statusFilter, setStatusFilter] = useUrlParam(searchParams, setSearchParams, 'status', '', { resetParams: ['page'] })

  const q = query.trim().toLowerCase()
  const filteredUsers = users.filter((u) => {
    if (statusFilter && u.accountStatus !== statusFilter) return false
    if (q && !(u.fullName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))) return false
    return true
  })
  const filtersActive = query !== '' || statusFilter !== ''

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, status: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredUsers, USER_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('admin-users', USER_COLUMNS)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setUsers(await listUsers())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleInvite(e) {
    e.preventDefault()
    setInviting(true)
    setInviteMessage(null)
    setError(null)
    try {
      await inviteUser(inviteEmail.trim())
      setInviteMessage(`Invitation sent to ${inviteEmail.trim()}.`)
      setInviteEmail('')
      setShowInviteForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setInviting(false)
    }
  }

  async function handleToggleBlocked(target) {
    setActioningId(target.id)
    setError(null)
    try {
      await setUserBlocked(target.id, target.accountStatus !== 'blocked')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Users</h2>
          <div className="flex items-center gap-2">
            <ColumnCustomizer
              idPrefix="admin-users"
              columns={columns}
              onToggle={toggleColumn}
              onMove={moveColumn}
              onReset={resetToDefault}
            />
            <button
              type="button"
              onClick={() => setShowInviteForm((v) => !v)}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
            >
              {showInviteForm ? 'Cancel' : '+ Invite user'}
            </button>
          </div>
        </div>

        {showInviteForm && (
          <form
            onSubmit={handleInvite}
            className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[220px]">
              <label className="block text-sm text-secondary mb-1" htmlFor="inviteEmail">
                Invite a user by email
              </label>
              <input
                id="inviteEmail"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </form>
        )}

        {inviteMessage && <p role="status" className="text-sm text-moss">{inviteMessage}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Search users"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="flex-1 min-w-[220px] rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <div role="group" aria-label="Filter by account status" className="flex items-center gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value || 'all'}
                type="button"
                aria-pressed={statusFilter === s.value}
                onClick={() => setStatusFilter(s.value)}
                className={`text-xs rounded-full px-3 py-1.5 border whitespace-nowrap ${
                  statusFilter === s.value ? 'border-moss text-ink font-medium bg-moss/10' : 'border-hairline text-secondary hover:text-ink'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs text-secondary hover:text-ink py-1.5 px-2 whitespace-nowrap"
            >
              Reset filters
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  {visibleColumns.map((col) =>
                    col.sortable ? (
                      <SortableTh key={col.key} label={col.label} columnKey={col.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={col.thClassName} />
                    ) : (
                      <th key={col.key} className={`px-4 py-2 font-medium ${col.thClassName || ''}`}>{col.label}</th>
                    )
                  )}
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((u) => (
                  <tr key={u.id} className="border-b border-hairline last:border-0">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={col.cellClassName} {...(col.cellProps ? col.cellProps(u) : {})}>
                        {col.renderCell(u)}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={actioningId === u.id || u.id === user.id}
                          onClick={() => handleToggleBlocked(u)}
                          title={u.id === user.id ? "You can't block your own account" : undefined}
                          className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
                        >
                          {actioningId === u.id
                            ? 'Working…'
                            : u.accountStatus === 'blocked'
                              ? 'Unblock'
                              : 'Block'}
                        </button>
                        <button
                          type="button"
                          disabled={u.id === user.id}
                          onClick={() => setDeleteTarget(u)}
                          title={u.id === user.id ? "You can't delete your own account from here" : undefined}
                          className="rounded-md border border-hairline text-red-700 py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumns.length + 1} className="px-4 py-6 text-center text-secondary">
                      {users.length === 0 ? 'No users yet.' : 'No users match your search or filter.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="admin-users" />
          </div>
        )}
      </div>

      {deleteTarget && (
        <DeleteUserDialog
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null)
            load()
          }}
        />
      )}
    </AdminLayout>
  )
}

// Loads what a hard delete would take with it (skills, courses, experience,
// connections, org memberships, admin status) before letting the admin
// confirm -- same "type DELETE to confirm" friction as the self-service
// "Delete account" flow on Profile.jsx, since this is just as irreversible.
function DeleteUserDialog({ target, onClose, onDeleted }) {
  const [linkages, setLinkages] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    getUserLinkages(target.id)
      .then(setLinkages)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [target.id])

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteUser(target.id)
      onDeleted()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  const blocked = linkages?.isLastPlatformAdmin

  return (
    <AccessibleDialog
      labelledBy="delete-user-title"
      describedBy="delete-user-description"
      onClose={deleting ? undefined : onClose}
      closeOnBackdrop={!deleting}
      overlayClassName="z-[60]"
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="delete-user-title" className="font-display text-lg text-ink mb-1">Delete {target.fullName || target.email}</h2>
        <p id="delete-user-description" className="text-sm text-secondary mb-4">
          Permanently deletes this account and everything in it. This can't be undone.
        </p>

        {loading ? (
          <p className="text-sm text-secondary mb-4">Checking what's linked to this account…</p>
        ) : (
          linkages && (
            <div className="bg-paper border border-hairline rounded-md p-3 mb-4 text-sm text-ink space-y-1">
              <p>
                {linkages.counts.skills} skill{linkages.counts.skills === 1 ? '' : 's'},{' '}
                {linkages.counts.courses} course{linkages.counts.courses === 1 ? '' : 's'},{' '}
                {linkages.counts.experience} experience/education {linkages.counts.experience === 1 ? 'entry' : 'entries'},{' '}
                {linkages.counts.connections} connection{linkages.counts.connections === 1 ? '' : 's'}
              </p>
              {linkages.organisations.length > 0 && (
                <p>
                  Member of: {linkages.organisations.map((o) => `${o.name} (${o.role})`).join(', ')}
                </p>
              )}
              {linkages.isPlatformAdmin && (
                <p className="text-red-700 font-medium">This person is a platform admin.</p>
              )}
              <p className="text-secondary text-xs pt-1">
                All of the above is deleted permanently. Peer ratings and validations they gave to other learners
                stay as evidence, with their identity removed.
              </p>
            </div>
          )
        )}

        {blocked ? (
          <p className="text-sm text-red-700 mb-4">
            This is the last remaining platform admin — grant admin access to someone else first.
          </p>
        ) : (
          !loading && (
            <>
              <label htmlFor="delete-user-confirmation" className="block text-sm text-ink mb-2">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </label>
              <input
                id="delete-user-confirmation"
                type="text"
                value={confirmText}
                disabled={deleting}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full rounded-md border border-hairline px-3 py-1.5 text-sm mb-4"
              />
            </>
          )
        )}

        {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || loading || blocked || confirmText !== 'DELETE'}
            className="rounded-md bg-red-700 text-white py-2 px-4 text-sm font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? 'Deleting…' : 'Permanently delete this account'}
          </button>
        </div>
    </AccessibleDialog>
  )
}
