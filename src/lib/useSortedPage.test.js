import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useSortedPage, useUrlParam, writeUrlParams } from './useSortedPage'

// Minimal stand-in for the searchParams/setSearchParams pair a page gets
// from react-router-dom's useSearchParams() -- these hooks only ever call
// searchParams.get() and setSearchParams(next, opts), so a real
// URLSearchParams plus a spy is enough to exercise the URL-sync behaviour
// without mounting a Router.
function makeUrlSync(initial = '') {
  const setSearchParams = vi.fn()
  return { searchParams: new URLSearchParams(initial), setSearchParams }
}

const ITEMS = [
  { id: 1, name: 'Charlie' },
  { id: 2, name: 'Alice' },
  { id: 3, name: 'Bob' },
]
const SORT_ACCESSORS = { name: (i) => i.name.toLowerCase() }

describe('writeUrlParams', () => {
  it('sets provided values and deletes null/undefined/empty ones, preserving untouched params', () => {
    const setSearchParams = vi.fn()
    const current = new URLSearchParams('keep=1&drop=old')
    writeUrlParams(current, setSearchParams, { drop: null, add: 'x' })
    const [next, opts] = setSearchParams.mock.calls[0]
    expect(next.get('keep')).toBe('1')
    expect(next.get('drop')).toBeNull()
    expect(next.get('add')).toBe('x')
    expect(opts).toEqual({ replace: true })
  })
})

describe('useUrlParam', () => {
  it('reads the initial value from the URL, falling back to the default when absent', () => {
    const urlSync = makeUrlSync('q=hello')
    const { result } = renderHook(() => useUrlParam(urlSync.searchParams, urlSync.setSearchParams, 'q', ''))
    expect(result.current[0]).toBe('hello')

    const empty = makeUrlSync('')
    const { result: result2 } = renderHook(() => useUrlParam(empty.searchParams, empty.setSearchParams, 'status', 'all'))
    expect(result2.current[0]).toBe('all')
  })

  it('writes a non-default value with replace:true and clears the resetParams', () => {
    const urlSync = makeUrlSync('page=3')
    const { result } = renderHook(() => useUrlParam(urlSync.searchParams, urlSync.setSearchParams, 'q', '', { resetParams: ['page'] }))
    act(() => result.current[1]('alice'))
    const [next, opts] = urlSync.setSearchParams.mock.calls[0]
    expect(next.get('q')).toBe('alice')
    expect(next.get('page')).toBeNull()
    expect(opts).toEqual({ replace: true })
  })

  it('deletes the param entirely when set back to its default value', () => {
    const urlSync = makeUrlSync('q=alice')
    const { result } = renderHook(() => useUrlParam(urlSync.searchParams, urlSync.setSearchParams, 'q', ''))
    act(() => result.current[1](''))
    const [next] = urlSync.setSearchParams.mock.calls[0]
    expect(next.has('q')).toBe(false)
  })
})

describe('useSortedPage local (non-url) mode', () => {
  it('sorts, toggles direction, and pages exactly as before urlSync existed', () => {
    const { result } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { defaultSortKey: 'name', pageSize: 2 }))
    expect(result.current.pageItems.map((i) => i.name)).toEqual(['Alice', 'Bob'])

    act(() => result.current.toggleSort('name'))
    expect(result.current.sortDir).toBe('desc')
    expect(result.current.pageItems.map((i) => i.name)).toEqual(['Charlie', 'Bob'])
  })
})

describe('useSortedPage urlSync mode', () => {
  it('parses sortKey/sortDir/page/pageSize from the URL on load', () => {
    const urlSync = makeUrlSync('sort=name&dir=desc&page=2&pageSize=1')
    const { result } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { defaultSortKey: null, urlSync }))
    expect(result.current.sortKey).toBe('name')
    expect(result.current.sortDir).toBe('desc')
    expect(result.current.pageSize).toBe(1)
    // desc order: Charlie, Bob, Alice -- page 2 of size 1 is Bob.
    expect(result.current.pageItems.map((i) => i.name)).toEqual(['Bob'])
  })

  it('falls back to defaults for a missing or invalid page/pageSize param', () => {
    const urlSync = makeUrlSync('page=abc&pageSize=-5')
    const { result } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { pageSize: 20, urlSync }))
    expect(result.current.page).toBe(1)
    expect(result.current.pageSize).toBe(20)
  })

  it('toggleSort writes sort/dir to the URL, resets page, and uses replace:true', () => {
    const urlSync = makeUrlSync('page=3')
    const { result } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { urlSync }))
    act(() => result.current.toggleSort('name'))
    const [next, opts] = urlSync.setSearchParams.mock.calls[0]
    expect(next.get('sort')).toBe('name')
    expect(next.get('dir')).toBe('asc')
    expect(next.has('page')).toBe(false)
    expect(opts).toEqual({ replace: true })
  })

  it('setPage supports the functional-updater form TablePagination uses, and omits page=1 from the URL', () => {
    const urlSync = makeUrlSync('page=2')
    const { result } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { urlSync }))
    act(() => result.current.setPage((p) => p - 1))
    const [next] = urlSync.setSearchParams.mock.calls[0]
    expect(next.has('page')).toBe(false) // resolves to 1, the default, so it's omitted

    const urlSync2 = makeUrlSync('')
    const { result: result2 } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { urlSync: urlSync2 }))
    act(() => result2.current.setPage(3))
    const [next2] = urlSync2.setSearchParams.mock.calls[0]
    expect(next2.get('page')).toBe('3')
  })

  it('setPageSize writes pageSize and resets page, omitting pageSize when it matches the initial default', () => {
    const urlSync = makeUrlSync('page=4')
    const { result } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { pageSize: 20, urlSync }))
    act(() => result.current.setPageSize(50))
    const [next] = urlSync.setSearchParams.mock.calls[0]
    expect(next.get('pageSize')).toBe('50')
    expect(next.has('page')).toBe(false)

    const urlSync2 = makeUrlSync('pageSize=50')
    const { result: result2 } = renderHook(() => useSortedPage(ITEMS, SORT_ACCESSORS, { pageSize: 20, urlSync: urlSync2 }))
    act(() => result2.current.setPageSize(20))
    const [next2] = urlSync2.setSearchParams.mock.calls[0]
    expect(next2.has('pageSize')).toBe(false)
  })
})
