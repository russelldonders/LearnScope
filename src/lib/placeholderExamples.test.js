import { describe, expect, it } from 'vitest'
import { pickExample } from './placeholderExamples'

describe('pickExample', () => {
  it('spreads seeds across the list, staying in range at the top end', () => {
    const list = ['a', 'b', 'c']
    expect([0, 0.34, 0.67, 0.9999].map((seed) => pickExample(list, seed))).toEqual(['a', 'b', 'c', 'c'])
  })

  it('passes a plain string through and copes with an empty list', () => {
    expect(pickExample('just one', 0.5)).toBe('just one')
    expect(pickExample([], 0.5)).toBe('')
  })
})
