import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import MutationFeedback from '../../components/MutationFeedback'
import {
  listAdminActivityLog,
  describeActivityAction,
  describeEntityType,
  ACTIVITY_ACTION_LABELS,
  ENTITY_TYPE_LABELS,
} from '../../lib/admin/activityLog'
import { useUrlParam, writeUrlParams } from '../../lib/useSortedPage'

// Console overhaul Phase 5 (see supabase/migrations/20260903090000_admin_
// activity_log.sql for the full design). Still deliberately no pagination --
// this only ever shows the most recent 200 rows (listAdminActivityLog's
// default limit) -- but the curated action list has grown enough that
// finding one actor/action/entity in a flat 200-row list was becoming the
// actual problem the original comment here predicted, so search + action/
// entity filters (client-side, over that same 200-row window) were added.
export default function AdminActivityLog() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '')
  const [actionFilter, setActionFilter] = useUrlParam(searchParams, setSearchParams, 'action', '')
  const [entityFilter, setEntityFilter] = useUrlParam(searchParams, setSearchParams, 'entity', '')
  const q = query.trim().toLowerCase()
  const filtersActive = query !== '' || actionFilter !== '' || entityFilter !== ''

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      if (actionFilter && entry.action !== actionFilter) return false
      if (entityFilter && entry.entity_type !== entityFilter) return false
      if (!q) return true
      const haystack = [entry.actor_label, entry.entity_label, entry.reason, describeActivityAction(entry.action), describeEntityType(entry.entity_type)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [entries, q, actionFilter, entityFilter])

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, action: null, entity: null })
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Search activity log"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actor, entity, or reason…"
            className="flex-1 min-w-[220px] rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <select
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="">All actions</option>
            {Object.entries(ACTIVITY_ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Filter by entity type"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="">All entity types</option>
            {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
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

        <MutationFeedback status="error" message={error} />

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">
              {entries.length === 0 ? 'No activity logged yet.' : 'No activity matches your search.'}
            </p>
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
                {filtered.map((entry) => (
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
