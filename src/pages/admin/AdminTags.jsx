import { useEffect, useMemo, useState } from 'react'
import AdminLayout from './AdminLayout'
import ConfirmDialog from '../../components/ConfirmDialog'
import { listAllTags, setTagBlacklisted } from '../../lib/admin/tags'
import { useRowSelection, useSortedPage } from '../../lib/useSortedPage'
import { BulkActionBar, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'

const TAG_SORT_ACCESSORS = {
  id: (t) => t.tag_code ?? '',
  name: (t) => t.name?.toLowerCase() ?? '',
  status: (t) => (t.is_blacklisted ? 1 : 0),
}

export default function AdminTags() {
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actioningId, setActioningId] = useState(null)
  const [bulkAction, setBulkAction] = useState(null)
  const [bulkActing, setBulkActing] = useState(false)

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(tags, TAG_SORT_ACCESSORS)
  const selection = useRowSelection(tags.map((t) => t.id))
  const selectedTags = useMemo(() => tags.filter((t) => selection.selected.has(t.id)), [tags, selection.selected])
  const selectedToBlacklist = useMemo(() => selectedTags.filter((t) => !t.is_blacklisted), [selectedTags])
  const selectedToUnblacklist = useMemo(() => selectedTags.filter((t) => t.is_blacklisted), [selectedTags])
  const pageIds = pageItems.map((t) => t.id)
  const selectedOnPage = pageIds.filter((id) => selection.selected.has(id)).length

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

  async function handleBulkToggle() {
    const { targets, blacklisted } = bulkAction
    setBulkActing(true)
    setError(null)
    try {
      const results = await Promise.allSettled(targets.map((tag) => setTagBlacklisted(tag.id, blacklisted)))
      const failures = results
        .map((result, index) => ({ result, tag: targets[index] }))
        .filter(({ result }) => result.status === 'rejected')
      const succeededIds = targets
        .filter((_, index) => results[index].status === 'fulfilled')
        .map((tag) => tag.id)
      setBulkAction(null)
      // Full success clears the whole selection; a partial failure keeps
      // the still-unchanged tags selected so they're easy to retry.
      if (failures.length > 0) selection.clearIds(succeededIds)
      else selection.clear()
      await load()
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${targets.length} tags couldn't be updated: ` +
            failures.map(({ tag, result }) => `"${tag.name}" (${result.reason?.message ?? 'unknown error'})`).join('; ')
        )
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBulkActing(false)
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
            <div className="p-3 pb-0">
              <BulkActionBar
                count={selection.selected.size}
                onClear={selection.clear}
                busy={bulkActing}
                actions={[
                  {
                    label: `Blacklist selected (${selectedToBlacklist.length})`,
                    disabled: selectedToBlacklist.length === 0,
                    title: selectedToBlacklist.length === 0 ? 'Every selected tag is already blacklisted' : undefined,
                    onClick: () => setBulkAction({ targets: selectedToBlacklist, blacklisted: true }),
                  },
                  {
                    label: `Remove from blacklist (${selectedToUnblacklist.length})`,
                    disabled: selectedToUnblacklist.length === 0,
                    title: selectedToUnblacklist.length === 0 ? 'None of the selected tags are blacklisted' : undefined,
                    onClick: () => setBulkAction({ targets: selectedToUnblacklist, blacklisted: false }),
                  },
                ]}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-secondary">
                    <SelectionTh
                      idPrefix="admin-tags"
                      checked={selection.isAllSelected(pageIds)}
                      indeterminate={selectedOnPage > 0 && selectedOnPage < pageIds.length}
                      onChange={() => selection.toggleAll(pageIds)}
                    />
                    <SortableTh label="ID" columnKey="id" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <SortableTh label="Tag" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh label="Status" columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="whitespace-nowrap" />
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((tag) => (
                    <tr key={tag.id} className="border-b border-hairline last:border-0">
                      <td className="px-4 py-2.5">
                        <label className="sr-only" htmlFor={`select-tag-${tag.id}`}>Select {tag.name}</label>
                        <input
                          id={`select-tag-${tag.id}`}
                          type="checkbox"
                          checked={selection.selected.has(tag.id)}
                          onChange={() => selection.toggle(tag.id)}
                          className="rounded border-hairline accent-moss"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-secondary whitespace-nowrap">{tag.tag_code}</td>
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

      {bulkAction && (
        <ConfirmDialog
          message={
            bulkAction.blacklisted
              ? `Blacklist ${bulkAction.targets.length} ${bulkAction.targets.length === 1 ? 'tag' : 'tags'}?`
              : `Remove ${bulkAction.targets.length} ${bulkAction.targets.length === 1 ? 'tag' : 'tags'} from the blacklist?`
          }
          confirmLabel={bulkAction.blacklisted ? 'Blacklist' : 'Remove from blacklist'}
          confirming={bulkActing}
          onConfirm={handleBulkToggle}
          onCancel={() => setBulkAction(null)}
        />
      )}
    </AdminLayout>
  )
}
