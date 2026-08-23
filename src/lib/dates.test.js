import { describe, it, expect } from 'vitest'
import { formatDateRange } from './dates'

describe('formatDateRange', () => {
  it('collapses a range that starts and ends in the same month to one label', () => {
    expect(formatDateRange('2024-03-01', '2024-03-15')).toBe(
      new Date(2024, 2).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    )
  })

  it('shows the exact date for a single-day item', () => {
    expect(formatDateRange('2024-03-01', '2024-03-01')).toBe(
      new Date('2024-03-01T00:00:00').toLocaleDateString()
    )
  })

  it('falls back to a single month label when there is no end date', () => {
    expect(formatDateRange('2024-03-01', null)).toBe(
      new Date(2024, 2).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    )
  })
})
