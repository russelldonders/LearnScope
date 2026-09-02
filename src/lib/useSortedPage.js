import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

// Row selection shared by every list table's bulk-action bar. Callers pass
// the ids of the current *filtered* (pre-pagination) list -- selection
// survives a page turn (same filtered view, just a different slice), but
// resets whenever that filtered set itself changes shape (search/filter
// change, or a reload after a bulk action added/removed rows), since a
// previously-selected id could otherwise point at a row no longer in view.
// A bulk action that only changes row state without changing which ids are
// present (e.g. bulk blacklist) won't trigger this on its own -- callers
// that want a hard reset after any bulk action should also call clear()
// once the action settles.
export function useRowSelection(ids) {
  const [selected, setSelected] = useState(() => new Set())
  const idsSignature = ids.join(' ')
  const previousSignature = useRef(idsSignature)

  useEffect(() => {
    if (previousSignature.current === idsSignature) return
    previousSignature.current = idsSignature
    setSelected(new Set())
  }, [idsSignature])

  const toggle = useCallback((id) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Scoped to whatever id list is passed in -- callers use this for the
  // current page's ids (header checkbox is deliberately page-scoped, not
  // "select all N matching").
  const toggleAll = useCallback((pageIds) => {
    setSelected((current) => {
      const allSelected = pageIds.length > 0 && pageIds.every((id) => current.has(id))
      const next = new Set(current)
      if (allSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  // Drops just the given ids from the selection, leaving any others
  // untouched -- for a bulk action that partially fails, callers pass the
  // ids that *succeeded* so the ones that failed stay selected and ready
  // for an easy retry, instead of clear()'s all-or-nothing reset.
  const clearIds = useCallback((idsToRemove) => {
    setSelected((current) => {
      const next = new Set(current)
      idsToRemove.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  const isAllSelected = useCallback(
    (pageIds) => pageIds.length > 0 && pageIds.every((id) => selected.has(id)),
    [selected]
  )

  return { selected, toggle, toggleAll, clear, clearIds, isAllSelected }
}
