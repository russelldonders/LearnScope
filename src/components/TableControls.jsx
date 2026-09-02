import { useEffect, useRef, useState } from 'react'
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

// Button + popover for showing/hiding and reordering a table's customizable
// data columns -- pass the `columns` array straight from
// useColumnPreferences (each entry already carries a `visible` flag) plus
// its toggleColumn/moveColumn/resetToDefault. Open/close (outside-click +
// Escape) mirrors AppHeader.jsx's account menu, the existing anchored-
// dropdown pattern in this codebase, rather than the full-screen
// AccessibleDialog modal, which would be too heavy for a small per-table
// settings panel.
export function ColumnCustomizer({ idPrefix, columns, onToggle, onMove, onReset }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const visibleKeys = columns.filter((c) => c.visible).map((c) => c.key)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Customize columns"
        className="flex items-center gap-1.5 rounded-md border border-hairline text-ink py-1.5 px-3 text-xs font-medium hover:bg-paper whitespace-nowrap"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <line x1="9" y1="4" x2="9" y2="20" />
          <line x1="15" y1="4" x2="15" y2="20" />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-md border border-hairline bg-card shadow-lg py-2 z-20">
          <p className="px-3 pb-1.5 text-[11px] uppercase tracking-wide text-secondary">Show &amp; reorder columns</p>
          <ul>
            {columns.map((column) => {
              const visiblePos = visibleKeys.indexOf(column.key)
              const isFirstVisible = visiblePos === 0
              const isLastVisible = visiblePos === visibleKeys.length - 1
              return (
                <li key={column.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-paper">
                  <input
                    id={`${idPrefix}-col-${column.key}`}
                    type="checkbox"
                    checked={column.visible}
                    disabled={column.visible && visibleKeys.length <= 1}
                    onChange={() => onToggle(column.key)}
                    className="rounded border-hairline accent-moss"
                  />
                  <label htmlFor={`${idPrefix}-col-${column.key}`} className="flex-1 text-sm text-ink truncate">
                    {column.label}
                  </label>
                  {column.visible && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => onMove(column.key, 'up')}
                        disabled={isFirstVisible}
                        aria-label={`Move ${column.label} column earlier`}
                        className="rounded border border-hairline text-secondary px-1 py-0.5 text-[10px] leading-none hover:text-ink disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(column.key, 'down')}
                        disabled={isLastVisible}
                        aria-label={`Move ${column.label} column later`}
                        className="rounded border border-hairline text-secondary px-1 py-0.5 text-[10px] leading-none hover:text-ink disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="border-t border-hairline mt-1 pt-1.5 px-3">
            <button type="button" onClick={onReset} className="text-xs text-secondary hover:text-ink py-1">
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
