// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ROW_PAGE_SIZE, selectAllRows } from './selectAllRows.js'

function fakeTable(total, { failAt } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const ranges = []
  const build = () => ({
    order: () => ({
      range: async (from, to) => {
        ranges.push([from, to])
        if (failAt === from) return { data: null, error: new Error('boom') }
        return { data: rows.slice(from, to + 1), error: null }
      },
    }),
  })
  return { build, ranges }
}

describe('selectAllRows', () => {
  it('reads past the 1,000-row cap in pages until a short page', async () => {
    const table = fakeTable(ROW_PAGE_SIZE * 2 + 5)
    const { data, error } = await selectAllRows(table.build, 'id')
    expect(error).toBeNull()
    expect(data).toHaveLength(ROW_PAGE_SIZE * 2 + 5)
    expect(table.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('makes one extra empty read when the total is an exact multiple of the page size', async () => {
    const table = fakeTable(ROW_PAGE_SIZE)
    const { data } = await selectAllRows(table.build, 'id')
    expect(data).toHaveLength(ROW_PAGE_SIZE)
    expect(table.ranges).toHaveLength(2)
  })

  it('returns the error from any page', async () => {
    const table = fakeTable(ROW_PAGE_SIZE * 2, { failAt: ROW_PAGE_SIZE })
    const { data, error } = await selectAllRows(table.build, 'id')
    expect(data).toBeNull()
    expect(error.message).toBe('boom')
  })
})
