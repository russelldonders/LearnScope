import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import { listAllTags, setTagBlacklisted } from '../../lib/admin/tags'

export default function AdminTags() {
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actioningId, setActioningId] = useState(null)

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
        ) : (
          <div className="bg-card border border-hairline rounded-lg divide-y divide-hairline">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center justify-between gap-3 p-3">
                <span className="text-ink text-sm">{tag.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {tag.is_blacklisted && (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-red-700 border border-red-300 rounded-full px-2 py-0.5">
                      Blacklisted
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={actioningId === tag.id}
                    onClick={() => handleToggle(tag)}
                    className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50"
                  >
                    {tag.is_blacklisted ? 'Remove from blacklist' : 'Blacklist'}
                  </button>
                </div>
              </div>
            ))}
            {tags.length === 0 && <p className="p-4 text-center text-secondary">No tags yet.</p>}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
