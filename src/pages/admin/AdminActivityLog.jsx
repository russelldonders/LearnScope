import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import MutationFeedback from '../../components/MutationFeedback'
import { listAdminActivityLog, describeActivityAction, describeEntityType } from '../../lib/admin/activityLog'

// Console overhaul Phase 5 (see supabase/migrations/20260903090000_admin_
// activity_log.sql for the full design). Deliberately minimal: a flat,
// most-recent-first list with no search/sort/pagination controls -- the
// full curated action list is now wired (course/user/skill/tag/
// organisation moderation, catalogue-approver and membership grants), so
// this table can grow; add filtering/pagination if that becomes a problem
// in practice rather than upfront.
export default function AdminActivityLog() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setEntries(await listAdminActivityLog())
    } catch (err) {
      setError(`Couldn't load the activity log: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        <MutationFeedback status="error" message={error} />

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No activity logged yet.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-secondary">
                  <th className="px-4 py-2 font-medium whitespace-nowrap">When</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Actor</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Action</th>
                  <th className="px-4 py-2 font-medium whitespace-nowrap">Entity</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-hairline last:border-0 align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap text-secondary">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink">{entry.actor_label}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink">
                      {describeActivityAction(entry.action)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink">
                      {describeEntityType(entry.entity_type)}
                      {entry.entity_label ? `: ${entry.entity_label}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{entry.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
