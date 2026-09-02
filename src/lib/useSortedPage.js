import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500]

// Conventional short query-param names for a URL-synced collection's own
// sort/page state -- shared by every list table so far (see useUrlParam
// below for the matching convention on search/filter fields: q, status,
// ...). Override via urlSync.paramNames only if a page ever needs two
// independent url-synced collections at once.
const DEFAULT_SORT_PARAM_NAMES = { sort: 'sort', dir: 'dir', page: 'page', pageSize: 'pageSize' }

// Merges `overrides` into a copy of `searchParams` (deleting a key whenever
// its override is null/undefined/''), then commits with `setSearchParams`.
// Mirrors the buildParams() helper ProviderConsole.jsx/
// ProviderCatalogueDetail.jsx already use for their own ?org=&section=/
// ?tab= state, so every url-synced piece of UI in the app builds the next
// URL the same way. `replace: true` by default -- collection state (a
// keystroke in a search box, a sort click, a page turn) is exactly the kind
// of frequent, transient edit that shouldn't spam browser history the way a
// deliberate navigation should; pass replace: false for a case that does
// want its own Back-button stop.
export function writeUrlParams(searchParams, setSearchParams, overrides, { replace = true } = {}) {
  const next = new URLSearchParams(searchParams)
  Object.entries(overrides).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') next.delete(key)
    else next.set(key, value)
  })
  setSearchParams(next, { replace })
}

// One URL-synced value (search text, a status filter, ...) that a page
// composes alongside useSortedPage's own `urlSync` option -- pass the same
// searchParams/setSearchParams pair from the page's single useSearchParams()
// call to both, so every param (q, status, sort, dir, page, pageSize) lands
// together in one URL. `resetParams` clears other params (typically
// ['page']) whenever this value changes, since a new search/filter
// invalidates whatever page number was in view. Always replace:true, per
// writeUrlParams' default above.
export function useUrlParam(searchParams, setSearchParams, key, defaultValue = '', { resetParams = [] } = {}) {
  const value = searchParams.get(key) ?? defaultValue
  function setValue(next) {
    const overrides = { [key]: next === defaultValue ? null : next }
    resetParams.forEach((param) => {
      overrides[param] = null
    })
    writeUrlParams(searchParams, setSearchParams, overrides)
  }
  return [value, setValue]
}

// Client-side sort + page over an already-filtered array, shared by every
// admin/provider console list table. sortAccessors maps a column key to a
// function extracting a comparable value from a row; sort falls back to
// each item's original position for ties (stable) so repeated clicks don't
// visibly reshuffle equal rows. Not included in the sort useMemo's
// dependency array -- callers pass a fresh object literal every render, and
// the memo body always closes over the latest one regardless, so adding it
// would only invalidate the cache on every render for no benefit.
//
// Pass `urlSync: { searchParams, setSearchParams, paramNames? }` (the page's
// own useSearchParams() result) to keep sort/page/pageSize in the URL
// instead of local state -- everything else about the hook's return value
// and behaviour (toggleSort resets to page 1, setPageSize resets to page 1,
// TablePagination's functional setPage((p) => ...) calls) stays identical
// either way, so existing callers are unaffected by leaving urlSync unset.
// oxlint-disable-next-line react-hooks/exhaustive-deps
export function useSortedPage(items, sortAccessors, { defaultSortKey = null, defaultSortDir = 'asc', pageSize: initialPageSize = 20, urlSync = null } = {}) {
  const paramNames = urlSync?.paramNames ? { ...DEFAULT_SORT_PARAM_NAMES, ...urlSync.paramNames } : DEFAULT_SORT_PARAM_NAMES

  // Local fallback state -- always declared (rules of hooks), but only ever
  // read from/written to when urlSync isn't passed.
  const [localSortKey, setLocalSortKey] = useState(defaultSortKey)
  const [localSortDir, setLocalSortDir] = useState(defaultSortDir)
  const [localPage, setLocalPage] = useState(1)
  const [localPageSize, setLocalPageSizeState] = useState(initialPageSize)

  let sortKey, sortDir, page, pageSize
  if (urlSync) {
    const params = urlSync.searchParams
    sortKey = params.get(paramNames.sort) ?? defaultSortKey
    const rawDir = params.get(paramNames.dir)
    sortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : defaultSortDir
    const rawPage = Number(params.get(paramNames.page))
    page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
    const rawPageSize = Number(params.get(paramNames.pageSize))
    pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? rawPageSize : initialPageSize
  } else {
    sortKey = localSortKey
    sortDir = localSortDir
    page = localPage
    pageSize = localPageSize
  }

  function toggleSort(key) {
    const nextDir = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
    if (urlSync) {
      writeUrlParams(urlSync.searchParams, urlSync.setSearchParams, {
        [paramNames.sort]: key === defaultSortKey ? null : key,
        [paramNames.dir]: key === defaultSortKey && nextDir === defaultSortDir ? null : nextDir,
        [paramNames.page]: null,
      })
    } else {
      setLocalSortKey(key)
      setLocalSortDir(nextDir)
      setLocalPage(1)
    }
  }

  function setPage(next) {
    if (urlSync) {
      const resolved = typeof next === 'function' ? next(page) : next
      writeUrlParams(urlSync.searchParams, urlSync.setSearchParams, { [paramNames.page]: resolved === 1 ? null : resolved })
    } else {
      setLocalPage(next)
    }
  }

  function setPageSize(size) {
    if (urlSync) {
      writeUrlParams(urlSync.searchParams, urlSync.setSearchParams, {
        [paramNames.pageSize]: size === initialPageSize ? null : size,
        [paramNames.page]: null,
      })
    } else {
      setLocalPageSizeState(size)
      setLocalPage(1)
    }
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

const COLUMN_PREFS_STORAGE_PREFIX = 'learnscope:admin-table-columns:'

// Show/hide + reorder preferences for a platform-admin data table's
// customizable data columns (never the pinned selection/actions columns --
// callers keep those out of `defaultColumns` entirely). Persists to
// localStorage per tableKey; a blocked/unavailable localStorage (or garbage
// left over from a previous shape) just falls back to the defaults instead
// of crashing, and a column key no longer present in `defaultColumns` (the
// table's own definition changed) is silently dropped rather than erroring.
//
// Order + visibility live together as one array of {key, visible} entries
// covering every default column. moveColumn swaps a column with its nearest
// *visible* neighbour in that array (skipping over hidden ones in between)
// so "up"/"down" always reorders what's actually rendered, even when a
// hidden column sits between two visible ones in storage.
export function useColumnPreferences(tableKey, defaultColumns) {
  const storageKey = `${COLUMN_PREFS_STORAGE_PREFIX}${tableKey}`
  const defaultKeys = useMemo(() => defaultColumns.map((c) => c.key), [defaultColumns])

  function defaultOrder() {
    return defaultKeys.map((key) => ({ key, visible: true }))
  }

  const [order, setOrder] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return defaultOrder()
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return defaultOrder()
      const known = new Set(defaultKeys)
      const kept = parsed.filter((entry) => entry && typeof entry.key === 'string' && known.has(entry.key))
      const seen = new Set(kept.map((entry) => entry.key))
      const missing = defaultKeys.filter((key) => !seen.has(key)).map((key) => ({ key, visible: true }))
      const result = [...kept, ...missing]
      return result.length > 0 ? result : defaultOrder()
    } catch {
      return defaultOrder()
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(order))
    } catch {
      // Blocked/unavailable localStorage -- preferences just won't persist.
    }
  }, [order, storageKey])

  const columnByKey = useMemo(() => new Map(defaultColumns.map((c) => [c.key, c])), [defaultColumns])

  const columns = useMemo(
    () =>
      order
        .map((entry) => {
          const def = columnByKey.get(entry.key)
          return def ? { ...def, visible: entry.visible } : null
        })
        .filter(Boolean),
    [order, columnByKey]
  )

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns])

  const toggleColumn = useCallback((key) => {
    setOrder((current) => {
      const visibleCount = current.filter((entry) => entry.visible).length
      const target = current.find((entry) => entry.key === key)
      if (!target) return current
      if (target.visible && visibleCount <= 1) return current // keep at least one column visible
      return current.map((entry) => (entry.key === key ? { ...entry, visible: !entry.visible } : entry))
    })
  }, [])

  const moveColumn = useCallback((key, direction) => {
    setOrder((current) => {
      const index = current.findIndex((entry) => entry.key === key)
      if (index === -1 || !current[index].visible) return current
      const step = direction === 'up' ? -1 : 1
      let swapWith = index + step
      while (swapWith >= 0 && swapWith < current.length && !current[swapWith].visible) {
        swapWith += step
      }
      if (swapWith < 0 || swapWith >= current.length) return current
      const next = [...current]
      ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
      return next
    })
  }, [])

  const resetToDefault = useCallback(() => {
    setOrder(defaultKeys.map((key) => ({ key, visible: true })))
  }, [defaultKeys])

  return { columns, visibleColumns, toggleColumn, moveColumn, resetToDefault }
}
