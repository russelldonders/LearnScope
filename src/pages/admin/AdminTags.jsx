import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import ConfirmDialog from '../../components/ConfirmDialog'
import StatusBadge from '../../components/StatusBadge'
import { listAllTags, setTagBlacklisted } from '../../lib/admin/tags'
import { useColumnPreferences, useRowSelection, useSortedPage, useUrlParam, writeUrlParams } from '../../lib/useSortedPage'
import { BulkActionBar, ColumnCustomizer, SelectionTh, SortableTh, TablePagination } from '../../components/TableControls'
import MutationFeedback from '../../components/MutationFeedback'

const TAG_SORT_ACCESSORS = {
  id: (t) => t.tag_code ?? '',
  name: (t) => t.name?.toLowerCase() ?? '',
  status: (t) => (t.is_blacklisted ? 1 : 0),
}

// Customizable data columns only -- the selection checkbox (first) and the
// per-row action button (last) stay pinned outside this list.
const TAG_COLUMNS = [
  {
    key: 'id',
    label: 'ID',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2.5 font-mono text-xs text-secondary whitespace-nowrap',
    renderCell: (t) => t.tag_code,
  },
  {
    key: 'name',
    label: 'Tag',
    sortable: true,
    cellClassName: 'px-4 py-2.5 text-ink whitespace-nowrap',
    renderCell: (t) => t.name,
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-2.5 whitespace-nowrap',
    renderCell: (t) => (
      <StatusBadge label={t.is_blacklisted ? 'Blacklisted' : 'Active'} tone={t.is_blacklisted ? 'danger' : 'neutral'} />
    ),
  },
]

export default function AdminTags() {
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actioningId, setActioningId] = useState(null)
  const [bulkAction, setBulkAction] = useState(null)
  const [bulkActing, setBulkActing] = useState(false)

  // Search text, sort, page and pageSize all live in the URL together
  // (?q=&sort=&dir=&page=&pageSize=) via useSortedPage's urlSync option and
  // useUrlParam -- same convention as AdminUsers.jsx/AdminCatalogue.jsx.
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useUrlParam(searchParams, setSearchParams, 'q', '', { resetParams: ['page'] })
  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => (q ? tags.filter((t) => t.name?.toLowerCase().includes(q)) : tags),
    [tags, q]
  )
  const filtersActive = query !== ''

  function resetFilters() {
    writeUrlParams(searchParams, setSearchParams, { q: null, page: null })
  }

  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(filtered, TAG_SORT_ACCESSORS, { urlSync: { searchParams, setSearchParams } })
  const { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault } =
    useColumnPreferences('admin-tags', TAG_COLUMNS)
  const selection = useRowSelection(filtered.map((t) => t.id))
  const selectedTags = useMemo(() => filtered.filter((t) => selection.selected.has(t.id)), [filtered, selection.selected])
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
      setError(`Couldn't load tags: ${err.message}`)
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
      setError(`Couldn't update this tag: ${err.message}`)
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
      setError(`Couldn't update tags: ${err.message}`)
    } finally {
      setBulkActing(false)
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Search tags"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags…"
            className="flex-1 min-w-[220px] rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
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
              {tags.length === 0 ? 'No tags yet.' : 'No tags match your search.'}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-hairline rounded-lg">
            <div className="flex items-center justify-end p-3 pb-0">
              <ColumnCustomizer
                idPrefix="admin-tags"
                columns={columns}
                onToggle={toggleColumn}
                onMove={moveColumn}
                onReset={resetToDefault}
              />
            </div>
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
                    {visibleColumns.map((col) =>
                      col.sortable ? (
                        <SortableTh key={col.key} label={col.label} columnKey={col.key} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className={col.thClassName} />
                      ) : (
                        <th key={col.key} className={`px-4 py-2 font-medium ${col.thClassName || ''}`}>{col.label}</th>
                      )
                    )}
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
                      {visibleColumns.map((col) => (
                        <td key={col.key} className={col.cellClassName}>
                          {col.renderCell(tag)}
                        </td>
                      ))}
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
