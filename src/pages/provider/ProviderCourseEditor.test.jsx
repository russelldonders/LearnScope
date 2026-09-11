import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

import { reorderById } from './ProviderCourseEditor'

describe('reorderById', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('moves the dragged item to sit right before the target, dragging downward', () => {
    const result = reorderById(list, 'a', 'c', 'id', 'before')
    expect(result.map((i) => i.id)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('moves the dragged item to sit right after the target, dragging downward', () => {
    const result = reorderById(list, 'a', 'c', 'id', 'after')
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves the dragged item to sit right before the target, dragging upward', () => {
    const result = reorderById(list, 'd', 'b', 'id', 'before')
    expect(result.map((i) => i.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves the dragged item to sit right after the target, dragging upward', () => {
    const result = reorderById(list, 'd', 'b', 'id', 'after')
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('is a no-op when dropping after the item immediately before it', () => {
    const result = reorderById(list, 'b', 'a', 'id', 'after')
    expect(result).toBe(list)
  })

  it('is a no-op when dropping before the item immediately after it', () => {
    const result = reorderById(list, 'a', 'b', 'id', 'before')
    expect(result).toBe(list)
  })

  it('is a no-op when dropped on itself', () => {
    expect(reorderById(list, 'a', 'a', 'id', 'before')).toBe(list)
  })

  it('is a no-op when there is no target', () => {
    expect(reorderById(list, 'a', null, 'id', 'before')).toBe(list)
  })
})
