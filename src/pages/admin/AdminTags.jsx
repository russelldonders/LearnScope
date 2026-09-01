import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import { listAllTags, setTagBlacklisted } from '../../lib/admin/tags'
import { useSortedPage } from '../../lib/useSortedPage'
import { SortableTh, TablePagination } from '../../components/TableControls'

const TAG_SORT_ACCESSORS = {
  id: (t) => t.id ?? '',
  name: (t) => t.name?.toLowerCase() ?? '',
  status: (t) => (t.is_blacklisted ? 1 : 0),
}

export default function AdminTags() {
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actioningId, setActioningId] = useState(null)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(tags, TAG_SORT_ACCESSORS)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setTags(await listAllTags())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(tag) {
    setActioningId(tag.id)
    setError(null)
    try {
      await setTagBlacklisted(tag.id, !tag.is_blacklisted)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActioningId(null)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : tags.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No tags yet.</p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SortableTh label="ID" columnKey="id" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Tag" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((tag) => (
                    <tr key={tag.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs text-secondary whitespace-nowrap">{tag.id.slice(0, 8)}</td>
                      <td className="px-4 py-2.5 text-ink whitespace-nowrap">{tag.name}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${
                            tag.is_blacklisted ? 'text-red-700 border-red-300' : 'text-secondary border-hairline'
                          }`}
                        >
                          {tag.is_blacklisted ? 'Blacklisted' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          disabled={actioningId === tag.id}
                          onClick={() => handleToggle(tag)}
                          className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
                        >
                          {tag.is_blacklisted ? 'Remove from blacklist' : 'Blacklist'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} totalItems={totalItems} idPrefix="admin-tags" />
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
