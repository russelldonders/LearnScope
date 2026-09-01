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
