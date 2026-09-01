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
import { useSortedPage } from '../../lib/useSortedPage'
import { SortableTh, TablePagination } from '../../components/TableControls'

const ORG_SORT_ACCESSORS = {
  name: (o) => o.name?.toLowerCase() ?? '',
  org_code: (o) => o.org_code?.toLowerCase() ?? '',
  type: (o) => o.type ?? '',
  status: (o) => o.status ?? '',
}

const STAFF_SORT_ACCESSORS = {
  email: (m) => (m.email || m.user_id || '').toLowerCase(),
  role: (m) => m.role ?? '',
}

export default function AdminProviders() {
  const { user } = useAuth()
  const [organisations, setOrganisations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const [expandedId, setExpandedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', url: '' })
  const [saving, setSaving] = useState(false)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(organisations, ORG_SORT_ACCESSORS)

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
        <form
          onSubmit={handleCreate}
          className="bg-card border border-hairline rounded-lg p-4 flex flex-wrap items-end gap-3"
        >
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm text-secondary mb-1" htmlFor="orgName">
              Create a provider organisation
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

        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : organisations.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No provider organisations yet.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SortableTh label="Organisation" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Code" columnKey="org_code" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Type" columnKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((org) => (
                    <OrganisationRow
                      key={org.id}
                      org={org}
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
    </AdminLayout>
  )
}

function OrganisationRow({
  org,
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
      <tr className="border-b border-hairline last:border-0 align-top">
        <td className="px-4 py-3">
          <p className="text-ink font-medium">{org.name}</p>
          {org.url && (
            <a href={org.url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium mt-0.5 inline-block truncate max-w-full">
              {org.url}
            </a>
          )}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap">{org.org_code}</td>
        <td className="px-4 py-3 text-secondary whitespace-nowrap">{org.type}</td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span
            className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${
              org.status === 'active' ? 'border-hairline text-secondary' : 'border-red-300 text-red-700'
            }`}
          >
            {org.status}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap justify-end">
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
          <td colSpan={5} className="px-4 pb-4 pt-1">
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
          <td colSpan={5} className="px-4 pb-4 pt-1">
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
                  <SortableTh label="User" columnKey="email" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={alwaysShowForm ? 'px-0' : ''} />
                  <SortableTh label="Role" columnKey="role" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => (
                  <tr key={m.id} className="border-b border-hairline last:border-0">
                    <td className={`py-2 text-ink text-xs truncate ${alwaysShowForm ? 'pl-0 pr-4' : 'px-4'}`}>{m.email || m.user_id}</td>
                    <td className="px-4 py-2 text-secondary text-xs whitespace-nowrap">
                      {m.role}
                      {m.status === 'pending' && ' · pending'}
                    </td>
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
