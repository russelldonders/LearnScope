import { useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import MutationFeedback from '../../components/MutationFeedback'
import { formatAbsoluteDate } from '../../lib/dates'
import {
  addChangelogEntry,
  confirmPlatformRelease,
  deleteChangelogEntry,
  getNextSuggestedVersion,
  listPendingChangelogEntries,
  listPlatformReleases,
  updateChangelogEntry,
} from '../../lib/admin/platformReleases'

// "What's new" for the platform admin console: a running list of unreleased
// changes (pending entries, added here as they ship to Staging) that gets
// bundled into a numbered version once confirmed for Production. This page
// only tracks version/changelog metadata -- it doesn't perform the actual
// staging->master merge or deploy, which stays the existing manual git
// workflow; confirm a release here around the same time as doing that
// merge.
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

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmVersion, setConfirmVersion] = useState('')
  const [confirmNotes, setConfirmNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState(null)

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

  async function openConfirm() {
    setConfirmError(null)
    setConfirmNotes('')
    setConfirmVersion(String(await getNextSuggestedVersion().catch(() => '')))
    setConfirmOpen(true)
  }

  async function handleConfirmRelease(e) {
    e.preventDefault()
    const versionNumber = Number(confirmVersion)
    if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
      setConfirmError('Enter a whole number greater than 0.')
      return
    }
    setConfirming(true)
    setConfirmError(null)
    try {
      await confirmPlatformRelease(versionNumber, confirmNotes)
      setConfirmOpen(false)
      await load()
    } catch (err) {
      setConfirmError(err.message)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-xl text-ink mb-1">What's new</h2>
          <p className="text-sm text-secondary">
            Track what's changed on Staging since the last release, then confirm a version when
            it's ready to go to Production.
          </p>
        </div>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {!loading && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <div className="flex items-start justify-between gap-4 mb-1">
              <h3 className="font-display text-lg text-ink">Pending (unreleased)</h3>
              <button
                type="button"
                onClick={openConfirm}
                disabled={pending.length === 0}
                className="shrink-0 rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm release…
              </button>
            </div>
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

        {confirmOpen && (
          <div className="bg-card border border-gold rounded-lg p-6">
            <h3 className="font-display text-lg text-ink mb-1">Confirm release</h3>
            <p className="text-sm text-secondary mb-4">
              Bundles all {pending.length} pending {pending.length === 1 ? 'entry' : 'entries'} into this version.
              The pending list starts fresh for whatever ships next.
            </p>
            <form onSubmit={handleConfirmRelease} className="space-y-3">
              <div>
                <label className="block text-xs text-secondary mb-1" htmlFor="releaseVersion">
                  Version
                </label>
                <input
                  id="releaseVersion"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={confirmVersion}
                  disabled={confirming}
                  onChange={(e) => setConfirmVersion(e.target.value)}
                  className="w-32 rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink"
                />
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1" htmlFor="releaseNotes">
                  Notes (optional)
                </label>
                <textarea
                  id="releaseNotes"
                  rows={2}
                  value={confirmNotes}
                  disabled={confirming}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink"
                />
              </div>
              {confirmError && <p role="alert" className="text-sm text-red-700">{confirmError}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={confirming}
                  className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirming}
                  className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {confirming ? 'Confirming…' : 'Confirm release'}
                </button>
              </div>
            </form>
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
