import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import AdminLayout from './AdminLayout'
import { listUsers, inviteUser, setUserBlocked } from '../../lib/admin/users'

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
                    <td className="px-4 py-2 text-ink whitespace-nowrap">{u.fullName || '—'}</td>
                    <td className="px-4 py-2 text-ink">{u.email}</td>
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
                      {u.isPlatformAdmin ? 'Platform admin' : ''}
                    </td>
                    <td className="px-4 py-2 text-right">
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
    </AdminLayout>
  )
}
