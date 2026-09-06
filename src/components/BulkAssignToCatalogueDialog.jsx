import { useEffect, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import { listPublicationCatalogueOptions } from '../lib/catalogues'

// Generic bulk "add selected rows to one catalogue" dialog, shared by every
// provider console list that can push items into a catalogue (Training,
// Skills, Resources) -- only ever offers a single catalogue destination at a
// time; picking several catalogues *and* several items at once would make
// the excluded/failed summary below unreadable. `getItemId`/`getItemLabel`
// decouple this from any one item shape (course/skill/resource each key and
// label their rows differently); `onAssign` is the one thing that actually
// differs per item type (which join table/RPC it writes to).
export default function BulkAssignToCatalogueDialog({
  organisationId,
  items,
  excludedItems = [],
  excludedReason,
  itemLabel,
  itemLabelPlural,
  description,
  getItemId = (item) => item.id,
  getItemLabel = (item) => item.name,
  onAssign,
  onClose,
  onDone,
}) {
  const singular = itemLabel
  const plural = itemLabelPlural || `${itemLabel}s`
  const [catalogues, setCatalogues] = useState([])
  const [catalogueId, setCatalogueId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listPublicationCatalogueOptions(organisationId)
      .then(setCatalogues)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [organisationId])

  async function handleSubmit() {
    if (!catalogueId || items.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const results = await Promise.allSettled(items.map((item) => onAssign(catalogueId, item)))
      const succeeded = items.filter((_, index) => results[index].status === 'fulfilled')
      const failures = results
        .map((result, index) => ({ result, item: items[index] }))
        .filter(({ result }) => result.status === 'rejected')
      // Reload/update the parent's selection regardless of outcome -- a
      // partial failure still means some items were actually added, so the
      // caller shouldn't stay stale (or lose track of which succeeded) just
      // because this dialog is staying open to show the failures.
      onDone(succeeded.map(getItemId), failures.length > 0)
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${items.length} ${failures.length === 1 ? singular : plural} couldn't be added: ` +
            failures.map(({ item, result }) => `"${getItemLabel(item)}" (${result.reason?.message ?? 'unknown error'})`).join('; ')
        )
        return
      }
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="bulk-assign-catalogue-title"
      describedBy="bulk-assign-catalogue-description"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-lg rounded-xl bg-card border border-hairline p-5 shadow-xl"
    >
      <h2 id="bulk-assign-catalogue-title" className="font-display text-lg text-ink">
        Add {items.length} {items.length === 1 ? singular : plural} to catalogue
      </h2>
      <p id="bulk-assign-catalogue-description" className="text-sm text-secondary mt-1 mb-3">
        {description}
      </p>
      {excludedItems.length > 0 && (
        <p className="text-xs text-amber-700 mb-3">
          {excludedItems.length} of the selected {excludedItems.length === 1 ? `${singular} isn’t` : `${plural} aren’t`}{' '}
          {excludedReason}, so {excludedItems.length === 1 ? "it won't" : "they won't"} be included:{' '}
          {excludedItems.map((item) => `"${getItemLabel(item)}"`).join(', ')}.
        </p>
      )}

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      {loading ? (
        <p role="status" className="text-sm text-secondary">Loading catalogues…</p>
      ) : catalogues.length === 0 ? (
        <p className="text-sm text-secondary">No publishing destinations are available.</p>
      ) : (
        <div className="divide-y divide-hairline border-y border-hairline">
          {catalogues.map((catalogue) => (
            <label key={catalogue.id} className="flex items-start gap-3 py-3 cursor-pointer">
              <input
                type="radio"
                name="bulk-assign-catalogue"
                checked={catalogueId === catalogue.id}
                onChange={() => setCatalogueId(catalogue.id)}
                className="mt-0.5 h-4 w-4 accent-moss"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{catalogue.name}</span>
                {catalogue.description && (
                  <span className="block text-xs text-secondary mt-0.5">{catalogue.description}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-paper disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || loading || !catalogueId || items.length === 0}
          className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add to catalogue'}
        </button>
      </div>
    </AccessibleDialog>
  )
}
