import { describe, expect, it } from 'vitest'
import { settledValue } from './settledValue'

describe('settledValue', () => {
  it('keeps the rest of a page usable when an optional query fails', () => {
    const results = [
      { status: 'fulfilled', value: 4 },
      { status: 'rejected', reason: new Error('relationship missing') },
    ]

    expect(settledValue(results, 0, 0)).toBe(4)
    expect(settledValue(results, 1, new Map())).toEqual(new Map())
  })
})
