import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import AdminLayout from './AdminLayout'
import ConfirmDialog from '../../components/ConfirmDialog'
import {
  listOrganisations,
  createOrganisation,
  updateOrganisation,
  setOrganisationStatus,
  listOrganisationMembers,
  removeOrganisationMember,
  inviteOrganisationStaff,
} from '../../lib/admin/organisations'
import { useColumnPreferences, useRowSelection, useSortedPage } from '../../lib/useSortedPage'
import { BulkActionBar, ColumnCustomizer, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'

const ORG_SORT_ACCESSORS = {
  name: (o) => o.name?.toLowerCase() ?? '',
  org_code: (o) => o.org_code?.toLowerCase() ?? '',
  url: (o) => o.url?.toLowerCase() ?? '',
  type: (o) => o.type ?? '',
  status: (o) => o.status ?? '',
}

// Customizable data columns only -- the selection checkbox (first) and the
// per-row action buttons (last) stay pinned outside this list. Scoped to
// this top-level organisations table -- the nested OrganisationStaffPanel
// table (its own sortable/paginated staff list) is a separate concept and
// stays out of the column-customization system.
const ORG_COLUMNS = [
  {
    key: 'org_code',
    label: 'ID',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap',
    renderCell: (o) => o.org_code,
  },
  {
    key: 'name',
    label: 'Organisation',
    sortable: true,
    cellClassName: 'px-4 py-3 text-ink font-medium whitespace-nowrap',
    renderCell: (o) => o.name,
  },
  {
    key: 'url',
    label: 'Website',
    sortable: true,
    cellClassName: 'px-4 py-3 truncate max-w-[200px]',
    renderCell: (o) =>
      o.url ? (
        <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium hover:underline">
          {o.url}
        </a>
      ) : (
        <span className="text-secondary">—</span>
      ),
  },
  {
    key: 'type',
    label: 'Type',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 text-secondary whitespace-nowrap',
    renderCell: (o) => o.type,
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 whitespace-nowrap',
    renderCell: (o) => (
      <span
        className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${
          o.status === 'active' ? 'border-hairline text-secondary' : 'border-red-300 text-red-700'
        }`}
      >
        {o.status}
      </span>
    ),
  },
]

const STAFF_SORT_ACCESSORS = {
  id: (m) => m.id ?? '',
  email: (m) => (m.email || m.user_id || '').toLowerCase(),
  role: (m) => m.role ?? '',
  status: (m) => m.status ?? '',
}

export default function AdminProviders() {
  const { user } = useAuth()
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const [expandedId, setExpandedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', url: '' })
  const [saving, setSaving] = useState(false)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(organisations, ORG_SORT_ACCESSORS)
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('admin-providers', ORG_COLUMNS)
  const selection = useRowSelection(organisations.map((o) => o.id))
  const selectedOrgs = useMemo(
    () => organisations.filter((o) => selection.selected.has(o.id)),
    [organisations, selection.selected]
  )
  const selectedToActivate = useMemo(() => selectedOrgs.filter((o) => o.status !== 'active'), [selectedOrgs])
  const selectedToSuspend = useMemo(() => selectedOrgs.filter((o) => o.status === 'active'), [selectedOrgs])
  const [bulkAction, setBulkAction] = useState(null)
  const [bulkActing, setBulkActing] = useState(false)
  const pageIds = pageItems.map((o) => o.id)
  const selectedOnPage = pageIds.filter((id) => selection.selected.has(id)).length

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setOrganisations(await listOrganisations())
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
      await createOrganisation(user.id, newName)
      setNewName('')
      setShowCreateForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleStatus(org) {
    setError(null)
    try {
      await setOrganisationStatus(org.id, org.status === 'active' ? 'inactive' : 'active')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleBulkStatusChange() {
    const { targets, status } = bulkAction
    setBulkActing(true)
    setError(null)
    try {
      const results = await Promise.allSettled(targets.map((org) => setOrganisationStatus(org.id, status)))
      const failures = results
        .map((result, index) => ({ result, org: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((org) => org.id)
      setBulkAction(null)
      // Full success clears the whole selection; a partial failure keeps
      // the still-unchanged organisations selected so they're easy to retry.
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await load()
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${targets.length} organisations couldn't be updated: ` +
            failures.map(({ org, result }) => `"${org.name}" (${result.reason?.message ?? 'unknown error'})`).join('; ')
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkActing(false)
    }
  }

  function startEdit(org) {
    setEditingId(org.id)
    setEditForm({ name: org.name, url: org.url ?? '' })
    setError(null)
  }

  async function handleSaveEdit(e, orgId) {
    e.preventDefault()
    if (!editForm.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await updateOrganisation(orgId, editForm)
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-ink">Providers</h2>
          <div className="flex items-center gap-2">
            <ColumnCustomizer
              idPrefix="admin-providers"
              columns={columns}
              onToggle={toggleColumn}
              onMove={moveColumn}
              onReset={resetToDefault}
            />
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
            >
              {showCreateForm ? 'Cancel' : '+ Create organisation'}
            </button>
          </div>
        </div>

        {showCreateForm && (
          <form
            onSubmit={handleCreate}
            className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-3"
          >
            <div className="flex-1 min-w-[220px]">
              <label className="block text-sm text-secondary mb-1" htmlFor="orgName">
                Organisation name
              </label>
              <input
                id="orgName"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Organisation name…"
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

        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : organisations.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No provider organisations yet.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                busy={bulkActing}
                actions={[
                  {
                    label: `Activate selected (${selectedToActivate.length})`,
                    disabled: selectedToActivate.length === 0,
                    title: selectedToActivate.length === 0 ? 'Every selected organisation is already active' : undefined,
                    onClick: () => setBulkAction({ targets: selectedToActivate, status: 'active' }),
                  },
                  {
                    label: `Suspend selected (${selectedToSuspend.length})`,
                    disabled: selectedToSuspend.length === 0,
                    title: selectedToSuspend.length === 0 ? 'None of the selected organisations are active' : undefined,
                    onClick: () => setBulkAction({ targets: selectedToSuspend, status: 'inactive' }),
                  },
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SelectionTh
                      idPrefix="admin-providers"
                      checked={selection.isAllSelected(pageIds)}
                      indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                      onChange={() => selection.toggleAll(pageIds)}
                    />
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
                  {pageItems.map((org) => (
                    <OrganisationRow
                      key={org.id}
                      org={org}
                      visibleColumns={visibleColumns}
                      selected={selection.selected.has(org.id)}
                      onToggleSelected={() => selection.toggle(org.id)}
                      editing={editingId === org.id}
                      editForm={editForm}
                      onEditFormChange={setEditForm}
                      saving={saving}
                      expanded={expandedId === org.id}
                      onStartEdit={() => startEdit(org)}
                      onCancelEdit={() => setEditingId(null)}
                      onSaveEdit={(e) => handleSaveEdit(e, org.id)}
                      onToggleExpanded={() => setExpandedId((id) => (id === org.id ? null : org.id))}
                      onToggleStatus={() => handleToggleStatus(org)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="admin-providers" />
          </div>
        )}
      </div>

      {bulkAction && (
        <ConfirmDialog
          message={
            bulkAction.status === 'active'
              ? `Activate ${bulkAction.targets.length} ${bulkAction.targets.length === 1 ? 'organisation' : 'organisations'}? Their users regain access.`
              : `Suspend ${bulkAction.targets.length} ${bulkAction.targets.length === 1 ? 'organisation' : 'organisations'}? Their users lose access until reactivated.`
          }
          confirmLabel={bulkAction.status === 'active' ? 'Activate' : 'Suspend'}
          confirming={bulkActing}
          onConfirm={handleBulkStatusChange}
          onCancel={() => setBulkAction(null)}
        />
      )}
    </AdminLayout>
  )
}

function OrganisationRow({
  org,
  visibleColumns,
  selected,
  onToggleSelected,
  editing,
  editForm,
  onEditFormChange,
  saving,
  expanded,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleExpanded,
  onToggleStatus,
}) {
  return (
    <>
      <tr className="border-b border-hairline last:border-0">
        <td className="px-4 py-3">
          <label className="sr-only" htmlFor={`select-org-${org.id}`}>Select {org.name}</label>
          <input
            id={`select-org-${org.id}`}
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            className="rounded border-hairline accent-moss"
          />
        </td>
        {visibleColumns.map((col) => (
          <td key={col.key} className={col.cellClassName}>
            {col.renderCell(org)}
          </td>
        ))}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 justify-end whitespace-nowrap">
            <button type="button" onClick={onStartEdit} className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper whitespace-nowrap">
              Edit
            </button>
            <button type="button" onClick={onToggleExpanded} className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper whitespace-nowrap">
              {expanded ? 'Hide users' : 'Manage users'}
            </button>
            <button type="button" onClick={onToggleStatus} className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper whitespace-nowrap">
              {org.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={visibleColumns.length + 2} className="px-4 pb-4 pt-1">
            <form onSubmit={onSaveEdit} className="space-y-3 border-t border-hairline pt-3">
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor={`orgEditName-${org.id}`}>
                  Name
                </label>
                <input
                  id={`orgEditName-${org.id}`}
                  required
                  value={editForm.name}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor={`orgEditUrl-${org.id}`}>
                  Website URL
                </label>
                <input
                  id={`orgEditUrl-${org.id}`}
                  type="url"
                  placeholder="https://…"
                  value={editForm.url}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, url: e.target.value }))}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <div className="flex items-center gap-2">
                <button type="submit" disabled={saving} className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={onCancelEdit} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper">
                  Cancel
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
      {expanded && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={visibleColumns.length + 2} className="px-4 pb-4 pt-1">
            <div className="border-t border-hairline pt-3">
              <OrganisationStaffPanel organisation={org} alwaysShowForm />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// Exported so the provider-facing console (src/pages/provider/) can reuse
// the same invite/remove staff UI, scoped to a provider's own organisation.
// alwaysShowForm keeps this panel's original always-open invite form for
// its home here (already gated behind AdminProviders' own "Manage users"
// accordion toggle, so a second toggle inside would just be a redundant
// extra click) -- ProviderConsole's Users tab instead gets the same
// "+ Invite user" toggle-to-reveal pattern as its Training/Skills/
// Resources tabs (see default false below).
export function OrganisationStaffPanel({ organisation, alwaysShowForm = false }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('admin')
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  useEffect(() => {
    load()
  }, [organisation.id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setMembers(await listOrganisationMembers(organisation.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleInvite(e) {
    e.preventDefault()
    setInviting(true)
    setMessage(null)
    setError(null)
    try {
      const result = await inviteOrganisationStaff(organisation.id, email.trim(), role)
      setMessage(
        result.alreadyExisted
          ? `${email.trim()} already had a LearnScope account — sent them a request to accept access.`
          : `Invitation sent to ${email.trim()}.`
      )
      setEmail('')
      if (!alwaysShowForm) setShowInviteForm(false)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove() {
    setError(null)
    setRemoving(true)
    try {
      await removeOrganisationMember(removeTarget.id)
      setRemoveTarget(null)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setRemoving(false)
    }
  }

  const formVisible = alwaysShowForm || showInviteForm
  const filteredMembers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return members.filter(
      (member) =>
        (roleFilter === 'all' || member.role === roleFilter) &&
        (!needle || [member.email, member.user_id].filter(Boolean).some((value) => value.toLowerCase().includes(needle)))
    )
  }, [members, query, roleFilter])

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filteredMembers, STAFF_SORT_ACCESSORS)

  return (
    <div className={alwaysShowForm ? 'border-t border-hairline bg-paper p-4 space-y-3' : 'space-y-3'}>
      {!alwaysShowForm && (
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-display text-lg text-ink">Users</h3>
          <button
            type="button"
            onClick={() => setShowInviteForm((v) => !v)}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
          >
            {showInviteForm ? 'Cancel' : '+ Invite user'}
          </button>
        </div>
      )}

      {formVisible && (
        <form
          onSubmit={handleInvite}
          className={
            alwaysShowForm
              ? 'flex flex-wrap items-end gap-2'
              : 'bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-2 mb-4'
          }
        >
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-secondary mb-1" htmlFor={`staffEmail-${organisation.id}`}>
              Invite users by email
            </label>
            <input
              id={`staffEmail-${organisation.id}`}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full rounded-md border border-hairline px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss ${
                alwaysShowForm ? 'bg-card' : 'bg-paper'
              }`}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor={`staffRole-${organisation.id}`}>
              Role
            </label>
            <select
              id={`staffRole-${organisation.id}`}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={`rounded-md border border-hairline px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss ${
                alwaysShowForm ? 'bg-card' : 'bg-paper'
              }`}
            >
              <option value="admin">Admin</option>
              <option value="trainer">Trainer</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {inviting ? 'Sending…' : 'Invite'}
          </button>
        </form>
      )}

      {!alwaysShowForm && (
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_180px] gap-2" role="search">
          <label className="sr-only" htmlFor={`staffSearch-${organisation.id}`}>Search users</label>
          <input id={`staffSearch-${organisation.id}`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users…" className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss" />
          <label className="sr-only" htmlFor={`staffRoleFilter-${organisation.id}`}>Filter users by role</label>
          <select id={`staffRoleFilter-${organisation.id}`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
            <option value="all">All roles</option>
            <option value="admin">Admins</option>
            <option value="trainer">Trainers</option>
          </select>
        </div>
      )}

      {message && <p className="text-xs text-moss">{message}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}

      {loading ? (
        <p className="text-xs text-secondary">Loading users…</p>
      ) : members.length === 0 ? (
        alwaysShowForm ? (
          <p className="text-xs text-secondary">No users yet.</p>
        ) : (
          <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No users yet.</p>
          </div>
        )
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No users match these filters.</p>
        </div>
      ) : (
        <div className={alwaysShowForm ? '' : 'bg-card border border-hairline rounded-lg'}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <SortableTh label="ID" columnKey="id" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={`whitespace-nowrap ${alwaysShowForm ? 'px-0' : ''}`} />
                  <SortableTh label="User" columnKey="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Role" columnKey="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => (
                  <tr key={m.id} className="border-b border-hairline last:border-0">
                    <td className={`py-2 font-mono text-[10px] text-secondary whitespace-nowrap ${alwaysShowForm ? 'pl-0 pr-4' : 'px-4'}`}>{m.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 text-ink text-xs truncate max-w-[220px]">{m.email || m.user_id}</td>
                    <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{m.role}</td>
                    <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">{m.status === 'pending' ? 'Pending' : 'Active'}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => setRemoveTarget(m)} className="text-xs text-red-700 hover:underline whitespace-nowrap">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix={`staff-${organisation.id}`} />
        </div>
      )}

      {removeTarget && (
        <ConfirmDialog
          message={`Remove ${removeTarget.email || removeTarget.user_id} from ${organisation.name}? They'll lose their ${removeTarget.role} access.`}
          onConfirm={handleRemove}
          onCancel={() => setRemoveTarget(null)}
          confirming={removing}
        />
      )}
    </div>
  )
}
