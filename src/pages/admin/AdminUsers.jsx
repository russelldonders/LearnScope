import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import AdminLayout from './AdminLayout'
import { listUsers, inviteUser, setUserBlocked, getUserLinkages, deleteUser } from '../../lib/admin/users'

export default function AdminUsers() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteAsAdmin, setInviteAsAdmin] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState(null)

  const [actioningId, setActioningId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

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
      await inviteUser(inviteEmail.trim(), inviteAsAdmin)
      setInviteMessage(`Invitation sent to ${inviteEmail.trim()}.`)
      setInviteEmail('')
      setInviteAsAdmin(false)
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
          <label className="flex items-center gap-2 text-sm text-secondary pb-2">
            <input
              type="checkbox"
              checked={inviteAsAdmin}
              onChange={(e) => setInviteAsAdmin(e.target.checked)}
              className="rounded border-hairline"
            />
            Grant platform admin access
          </label>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {inviting ? 'Sending…' : 'Send invite'}
          </button>
        </form>

        {inviteMessage && <p className="text-sm text-moss">{inviteMessage}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <div className="bg-card border border-hairline rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-hairline last:border-0">
                    <td className="px-4 py-2 text-ink whitespace-nowrap">
                      <Link to={`/admin/users/${u.id}`} className="hover:text-moss hover:underline">
                        {u.fullName || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink">
                      <Link to={`/admin/users/${u.id}`} className="hover:text-moss hover:underline">
                        {u.email}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border whitespace-nowrap ${
                          u.accountStatus === 'blocked'
                            ? 'border-red-300 text-red-700'
                            : 'border-hairline text-secondary'
                        }`}
                      >
                        {u.accountStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-secondary whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        {u.isPlatformAdmin && <span>Platform admin</span>}
                        {u.organisationMemberships.map((m, i) => (
                          <span key={i}>
                            {m.organisationName} ({m.role})
                          </span>
                        ))}
                      </div>
                    </td>
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
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-secondary">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[60]" onClick={onClose}>
      <div className="w-full max-w-md bg-card border border-hairline rounded-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg text-ink mb-1">Delete {target.fullName || target.email}</h3>
        <p className="text-sm text-secondary mb-4">
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
              <label className="block text-sm text-ink mb-2">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                disabled={deleting}
                onChange={(e) => setConfirmText(e.target.value)}
                className="w-full rounded-md border border-hairline px-3 py-1.5 text-sm mb-4"
              />
            </>
          )
        )}

        {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

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
      </div>
    </div>
  )
}
