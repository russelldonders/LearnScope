import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatDateRange, formatRelativeDate, formatAbsoluteDate, formatFullDate } from './dates'

describe('formatFullDate', () => {
  it('formats a full assessment timestamp without producing Invalid Date', () => {
    const timestamp = '2026-08-29T09:41:27Z'
    expect(formatFullDate(timestamp)).toBe(new Date(timestamp).toLocaleDateString())
  })
})

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

describe('formatRelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 2, 15, 14, 30))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels today, yesterday and tomorrow', () => {
    expect(formatRelativeDate('2024-03-15')).toBe('Today')
    expect(formatRelativeDate('2024-03-14')).toBe('Yesterday')
    expect(formatRelativeDate('2024-03-16')).toBe('Tomorrow')
  })

  it('labels dates further out in either direction', () => {
    expect(formatRelativeDate('2024-03-12')).toBe('3 days ago')
    expect(formatRelativeDate('2024-03-20')).toBe('In 5 days')
  })

  it('scales to months once the day count gets too high to read at a glance', () => {
    expect(formatRelativeDate('2024-01-15')).toBe('2 months ago')
    expect(formatRelativeDate('2024-05-14')).toBe('In 2 months')
  })

  it('scales to years for dates far in the past or future', () => {
    expect(formatRelativeDate('2022-03-15')).toBe('2 years ago')
    expect(formatRelativeDate('2026-03-15')).toBe('In 2 years')
  })

  it('compares calendar days, not raw elapsed hours, for a full timestamp', () => {
    // 2024-03-15T23:00 is still "today" by calendar date even though it's
    // under 24 raw hours from the fake "now" of 2024-03-15T14:30.
    expect(formatRelativeDate('2024-03-15T23:00:00')).toBe('Today')
  })

  it('returns an empty string for a missing date', () => {
    expect(formatRelativeDate(null)).toBe('')
  })
})

describe('formatAbsoluteDate', () => {
  it('formats a date-only string', () => {
    expect(formatAbsoluteDate('2024-03-01')).toBe(new Date('2024-03-01T00:00:00').toLocaleDateString())
  })

  it('formats a full timestamp', () => {
    const timestamp = '2024-03-01T09:15:00Z'
    expect(formatAbsoluteDate(timestamp)).toBe(new Date(timestamp).toLocaleDateString())
  })
})
