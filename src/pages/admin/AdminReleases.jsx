import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import MutationFeedback from '../../components/MutationFeedback'
import { formatAbsoluteDate } from '../../lib/dates'
import {
  addChangelogEntry,
  deleteChangelogEntry,
  listPendingChangelogEntries,
  listPlatformReleases,
  updateChangelogEntry,
} from '../../lib/admin/platformReleases'

// "What's new" for the platform admin console: a running list of unreleased
// changes (pending entries, added here as they ship to Staging) that gets
// bundled into a numbered version automatically -- see
// .github/workflows/release-platform-version.yml and
// scripts/release-platform-version.mjs, which run on every push to master
// and mirror the same version and entries onto Production. This page is
// read-only for versioning: it tracks pending entries (still added/edited/
// removed by hand here) and shows release history, but no longer triggers
// a release itself.
export default function AdminReleases() {
  const [pending, setPending] = useState([])
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [newEntry, setNewEntry] = useState('')
  const [addingEntry, setAddingEntry] = useState(false)
  const [addEntryError, setAddEntryError] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [entryBusyId, setEntryBusyId] = useState(null)
  const [entryError, setEntryError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [pendingData, releasesData] = await Promise.all([
        listPendingChangelogEntries(),
        listPlatformReleases(),
      ])
      setPending(pendingData)
      setReleases(releasesData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAddEntry(e) {
    e.preventDefault()
    if (!newEntry.trim()) return
    setAddingEntry(true)
    setAddEntryError(null)
    try {
      await addChangelogEntry(newEntry)
      setNewEntry('')
      await load()
    } catch (err) {
      setAddEntryError(err.message)
    } finally {
      setAddingEntry(false)
    }
  }

  function startEditing(entry) {
    setEditingId(entry.id)
    setEditingValue(entry.summary)
    setEntryError(null)
  }

  async function handleSaveEdit(id) {
    if (!editingValue.trim()) return
    setEntryBusyId(id)
    setEntryError(null)
    try {
      await updateChangelogEntry(id, editingValue)
      setEditingId(null)
      await load()
    } catch (err) {
      setEntryError(err.message)
    } finally {
      setEntryBusyId(null)
    }
  }

  async function handleDeleteEntry(id) {
    setEntryBusyId(id)
    setEntryError(null)
    try {
      await deleteChangelogEntry(id)
      await load()
    } catch (err) {
      setEntryError(err.message)
    } finally {
      setEntryBusyId(null)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-xl text-ink mb-1">What's new</h2>
          <p className="text-sm text-secondary">
            Track what's changed on Staging since the last release. A new version is bundled and
            published to Production automatically the next time this batch goes live.
          </p>
        </div>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {!loading && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <h3 className="font-display text-lg text-ink mb-1">Pending (unreleased)</h3>
            <p className="text-sm text-secondary mb-4">
              What's shipped to Staging since version {releases[0]?.version ?? 0}.
            </p>

            {entryError && <p role="alert" className="text-sm text-red-700 mb-3">{entryError}</p>}

            {pending.length === 0 ? (
              <p className="text-sm text-secondary mb-4">Nothing pending yet.</p>
            ) : (
              <ul className="divide-y divide-hairline mb-4">
                {pending.map((entry) => (
                  <li key={entry.id} className="py-2">
                    {editingId === entry.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          className="flex-1 min-w-[12rem] rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(entry.id)}
                          disabled={entryBusyId === entry.id}
                          className="text-xs font-medium text-moss hover:underline disabled:opacity-60"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs font-medium text-secondary hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-ink">{entry.summary}</span>
                        <div className="shrink-0 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => startEditing(entry)}
                            className="text-xs font-medium text-secondary hover:text-ink"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(entry.id)}
                            disabled={entryBusyId === entry.id}
                            className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={handleAddEntry} className="flex flex-wrap items-center gap-2 pt-3 border-t border-hairline">
              <input
                value={newEntry}
                disabled={addingEntry}
                onChange={(e) => setNewEntry(e.target.value)}
                placeholder="What changed?"
                className="flex-1 min-w-[14rem] rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink"
              />
              <button
                type="submit"
                disabled={addingEntry || !newEntry.trim()}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Add
              </button>
            </form>
            <MutationFeedback status="error" message={addEntryError} className="mt-2" />
          </div>
        )}

        <div>
          <h3 className="font-display text-lg text-ink mb-3">Release history</h3>
          {loading ? (
            <p className="text-sm text-secondary">Loading…</p>
          ) : releases.length === 0 ? (
            <p className="text-sm text-secondary">No releases confirmed yet.</p>
          ) : (
            <div className="space-y-4">
              {releases.map((release) => (
                <div key={release.id} className="bg-card border border-hairline rounded-lg p-6">
                  <div className="flex items-center justify-between gap-4 mb-1">
                    <h4 className="font-display text-base text-ink">Version {release.version}</h4>
                    <span className="text-xs text-secondary">{formatAbsoluteDate(release.releasedAt)}</span>
                  </div>
                  {release.notes && <p className="text-sm text-secondary mb-3">{release.notes}</p>}
                  {release.entries.length === 0 ? (
                    <p className="text-sm text-secondary">No changelog entries recorded for this version.</p>
                  ) : (
                    <ul className="list-disc list-inside text-sm text-ink space-y-1">
                      {release.entries.map((entry) => (
                        <li key={entry.id}>{entry.summary}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
