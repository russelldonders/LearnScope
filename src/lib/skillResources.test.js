import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const {
  audiencesFor,
  filterResourcesByLevel,
  isHttpUrl,
  resourceLevelFit,
  sortResourcesByFit,
  suggestResourcesForLevel,
} = await import('./skillResources')

const res = (id, knowledge_level = null, practical_level = null, created_at = '2026-11-01') => ({ id, knowledge_level, practical_level, created_at })

describe('resourceLevelFit', () => {
  it('calls a resource at the learner\'s level "current" and one above "next", both a perfect fit', () => {
    expect(resourceLevelFit(res('a', 3), { knowledge: 3 })).toEqual({ distance: 0, fit: 'current' })
    expect(resourceLevelFit(res('a', 4), { knowledge: 3 })).toEqual({ distance: 0, fit: 'next' })
  })

  it('counts levels further away, below or above', () => {
    expect(resourceLevelFit(res('a', 1), { knowledge: 3 })).toEqual({ distance: 2, fit: null })
    expect(resourceLevelFit(res('a', 5), { knowledge: 3 })).toEqual({ distance: 1, fit: null })
  })

  it('averages over the axes both sides have, and ignores the rest', () => {
    expect(resourceLevelFit(res('a', 4, 1), { knowledge: 3, practical: 3 })).toEqual({ distance: 1, fit: 'next' })
    expect(resourceLevelFit(res('a', 4, 1), { knowledge: 3 })).toEqual({ distance: 0, fit: 'next' })
    expect(resourceLevelFit(res('a', null, 2), { knowledge: 3 })).toBeNull()
    expect(resourceLevelFit(res('a', 3), {})).toBeNull()
  })
})

describe('filterResourcesByLevel', () => {
  it('keeps everything with no filter, and exact matches per chosen axis', () => {
    const list = [res('a', 2, 3), res('b', 2), res('c', null, 3)]
    expect(filterResourcesByLevel(list, {})).toHaveLength(3)
    expect(filterResourcesByLevel(list, { knowledge: '2' }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(filterResourcesByLevel(list, { knowledge: '2', practical: '3' }).map((r) => r.id)).toEqual(['a'])
  })
})

describe('sortResourcesByFit', () => {
  it('puts the nearest first, then newest, and unlevelled last', () => {
    const list = [
      res('far', 1, null, '2026-11-05'),
      res('none', null, null, '2026-11-09'),
      res('next', 4, null, '2026-11-01'),
      res('current', 3, null, '2026-11-03'),
    ]
    expect(sortResourcesByFit(list, { knowledge: 3 }).map((r) => r.id)).toEqual(['current', 'next', 'far', 'none'])
  })
})

describe('suggestResourcesForLevel', () => {
  it('suggests resources at the current level or the next, next steps first, up to the limit', () => {
    const list = [res('cur', 3, null, '2026-11-05'), res('nxt', 4), res('far', 1), res('nxt2', 4, null, '2026-11-02'), res('none')]
    const ids = suggestResourcesForLevel(list, { knowledge: 3 }).map((s) => s.resource.id)
    expect(ids).toEqual(['nxt2', 'nxt', 'cur'])
    expect(suggestResourcesForLevel(list, { knowledge: 3 }, 1)).toHaveLength(1)
    expect(suggestResourcesForLevel(list, {})).toEqual([])
  })
})

describe('sharing helpers', () => {
  it('only accepts http(s) links', () => {
    expect(isHttpUrl('https://example.com')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })

  it('never offers public sharing for files or skills outside the library', () => {
    expect(audiencesFor('link', { hasLibrarySkill: true })).toContain('skill_public')
    expect(audiencesFor('file', { hasLibrarySkill: true })).not.toContain('skill_public')
    expect(audiencesFor('link', { hasLibrarySkill: false })).not.toContain('skill_public')
  })
})
