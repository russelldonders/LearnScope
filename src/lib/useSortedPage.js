import { useMemo, useState } from 'react'

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500]

// Client-side sort + page over an already-filtered array, shared by every
// admin/provider console list table. sortAccessors maps a column key to a
// function extracting a comparable value from a row; sort falls back to
// each item's original position for ties (stable) so repeated clicks don't
// visibly reshuffle equal rows. Not included in the sort useMemo's
// dependency array -- callers pass a fresh object literal every render, and
// the memo body always closes over the latest one regardless, so adding it
// would only invalidate the cache on every render for no benefit.
// oxlint-disable-next-line react-hooks/exhaustive-deps
export function useSortedPage(items, sortAccessors, { defaultSortKey = null, defaultSortDir = 'asc', pageSize: initialPageSize = 20 } = {}) {
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState(defaultSortDir)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(initialPageSize)

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(1)
  }

  function setPageSize(size) {
    setPageSizeState(size)
    setPage(1)
  }

  const sorted = useMemo(() => {
    const accessor = sortKey ? sortAccessors[sortKey] : null
    if (!accessor) return items
    return items
      .map((item, index) => ({ item, index, value: accessor(item) }))
      .sort((a, b) => {
        const av = a.value
        const bv = b.value
        let cmp
        if (av == null && bv == null) cmp = 0
        else if (av == null) cmp = -1
        else if (bv == null) cmp = 1
        else if (typeof av === 'string') cmp = av.localeCompare(bv)
        else cmp = av < bv ? -1 : av > bv ? 1 : 0
        if (cmp === 0) cmp = a.index - b.index
        return sortDir === 'asc' ? cmp : -cmp
      })
      .map((entry) => entry.item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sortKey, sortDir])

  const totalItems = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize]
  )

  return { sortKey, sortDir, toggleSort, page: safePage, setPage, pageSize, setPageSize, pageItems, totalItems, totalPages }
}
