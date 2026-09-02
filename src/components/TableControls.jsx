import { useEffect, useRef } from 'react'
import { PAGE_SIZE_OPTIONS } from '../lib/useSortedPage'

// A <th> whose whole label is a button toggling sort on that column --
// matches how every list table in the two consoles now sorts, so a column
// header always looks and behaves the same wherever it appears.
export function SortableTh({ label, columnKey, sortKey, sortDir, onSort, className = '', align = 'left' }) {
  const active = sortKey === columnKey
  return (
    <th className={`px-4 py-2 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`flex items-center gap-1 hover:text-ink ${align === 'right' ? 'ml-auto' : ''}`}
        aria-label={`Sort by ${label}${active ? (sortDir === 'asc' ? ', ascending' : ', descending') : ''}`}
      >
        {label}
        <span aria-hidden="true" className={`text-[10px] ${active ? 'text-ink' : 'text-hairline'}`}>
          {active && sortDir === 'desc' ? '▼' : '▲'}
        </span>
      </button>
    </th>
  )
}

// Sits below a table's own overflow-x-auto scroll wrapper (not inside it)
// so the page-size/prev-next controls stay fixed instead of scrolling
// away with wide tables -- see any of the list tables for the wrapper
// shape this expects: <div className="... rounded-lg"><div
// className="overflow-x-auto"><table>...</table></div><TablePagination
// .../></div>.
export function TablePagination({ page, setPage, pageSize, setPageSize, totalItems, pageSizeOptions = PAGE_SIZE_OPTIONS, idPrefix }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalItems)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-2.5 text-xs text-secondary">
      <p>{totalItems === 0 ? 'No results' : `Showing ${from}–${to} of ${totalItems}`}</p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5" htmlFor={`${idPrefix}-page-size`}>
          Per page
          <select
            id={`${idPrefix}-page-size`}
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-md border border-hairline bg-card px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="rounded-md border border-hairline px-2 py-1 disabled:opacity-40 hover:bg-paper" aria-label="First page">«</button>
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-md border border-hairline px-2 py-1 disabled:opacity-40 hover:bg-paper" aria-label="Previous page">‹</button>
          <span className="px-1 tabular-nums">{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-md border border-hairline px-2 py-1 disabled:opacity-40 hover:bg-paper" aria-label="Next page">›</button>
          <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="rounded-md border border-hairline px-2 py-1 disabled:opacity-40 hover:bg-paper" aria-label="Last page">»</button>
        </div>
      </div>
    </div>
  )
}

// Header checkbox for a table's selection column -- toggles every row on
// the *current page only* (matches TablePagination's own page-scoped
// mental model; there's no "select all N matching" affordance). `title`
// makes that page-scoped behaviour discoverable on hover since the checkbox
// itself can't say it.
export function SelectionTh({ idPrefix, checked, indeterminate = false, onChange, disabled = false }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <th className="w-8 px-4 py-2">
      <label className="sr-only" htmlFor={`${idPrefix}-select-all`}>Select all rows on this page</label>
      <input
        ref={ref}
        id={`${idPrefix}-select-all`}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        title="Selects rows on this page only"
        className="rounded border-hairline accent-moss"
      />
    </th>
  )
}

// Sits above a table (inside the same wrapper as any search/filter row) --
// renders nothing once nothing is selected, so it never occupies layout
// space when unused. `actions` mirrors a row's own action buttons
// (default/danger variant, per-action disabled) so bulk actions look like a
// natural extension of the per-row ones already in these tables. `busy`
// mirrors the actioningId-style guard already used for single-row actions --
// disables every action and Clear while one bulk action is in flight, so a
// second click can't fire a duplicate run.
export function BulkActionBar({ count, onClear, actions, busy = false }) {
  if (count === 0) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-card px-4 py-2.5"
    >
      <p className="text-sm font-medium text-ink">{count} selected</p>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            disabled={busy || action.disabled}
            title={action.title}
            className={
              action.variant === 'danger'
                ? 'rounded-md border border-red-300 text-red-700 py-1.5 px-3 text-xs font-medium hover:bg-red-50 disabled:opacity-50 whitespace-nowrap'
                : 'rounded-md border border-hairline text-ink py-1.5 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap'
            }
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="text-xs text-secondary hover:text-ink disabled:opacity-50 whitespace-nowrap"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
