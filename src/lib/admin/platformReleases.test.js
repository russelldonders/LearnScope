import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
vi.mock('../supabaseClient', () => ({ supabase: { from } }))

const {
  addChangelogEntry,
  deleteChangelogEntry,
  listPendingChangelogEntries,
  listPlatformReleases,
  updateChangelogEntry,
} = await import('./platformReleases')

function chain(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    is: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  }
  return builder
}

describe('platformReleases service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists pending (unreleased) changelog entries', async () => {
    from.mockReturnValue(chain({ data: [{ id: 'e1', summary: 'Added X', created_at: '2026-09-01' }], error: null }))
    const result = await listPendingChangelogEntries()
    expect(from).toHaveBeenCalledWith('platform_changelog_entries')
    expect(result).toEqual([{ id: 'e1', summary: 'Added X', created_at: '2026-09-01' }])
  })

  it('adds a trimmed changelog entry', async () => {
    const builder = chain({ data: null, error: null })
    from.mockReturnValue(builder)
    await addChangelogEntry('  Fixed a bug  ')
    expect(builder.insert).toHaveBeenCalledWith({ summary: 'Fixed a bug' })
  })

  it('updates a pending entry', async () => {
    const builder = chain({ data: null, error: null })
    from.mockReturnValue(builder)
    await updateChangelogEntry('e1', 'New wording')
    expect(builder.update).toHaveBeenCalledWith({ summary: 'New wording' })
    expect(builder.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('deletes a pending entry', async () => {
    const builder = chain({ data: null, error: null })
    from.mockReturnValue(builder)
    await deleteChangelogEntry('e1')
    expect(builder.delete).toHaveBeenCalled()
    expect(builder.eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('maps release history newest-first with entries sorted oldest-first', async () => {
    from.mockReturnValue(chain({
      data: [{
        id: 'r2', version: 2, notes: null, released_at: '2026-09-10',
        platform_changelog_entries: [
          { id: 'e2', summary: 'Second', created_at: '2026-09-09' },
          { id: 'e1', summary: 'First', created_at: '2026-09-08' },
        ],
      }],
      error: null,
    }))
    const result = await listPlatformReleases()
    expect(result[0].version).toBe(2)
    expect(result[0].entries.map((e) => e.summary)).toEqual(['First', 'Second'])
  })
})
