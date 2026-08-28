import { describe, it, expect, afterEach, vi } from 'vitest'
import { todayDateString, computeNextSelfAssessmentDate, isSelfAssessmentDue } from './checkin'

afterEach(() => {
  vi.useRealTimers()
})

// Builds the "correct" Y-M-D independently of checkin.js, from the same
// fake instant's local getters -- the definition of "today" in the
// learner's own timezone. A regression back to toISOString().slice(0, 10)
// (the UTC calendar date) would only coincidentally match this on a host
// whose local timezone is UTC itself.
function expectedLocalDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

describe('todayDateString', () => {
  it('matches the local calendar date, with zero-padded month/day', () => {
    const now = new Date(Date.UTC(2024, 2, 5, 6, 0, 0))
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(todayDateString()).toBe(expectedLocalDateString(now))
  })
})

describe('computeNextSelfAssessmentDate', () => {
  it('adds weeks/months/years from a given date, returning the local calendar date', () => {
    expect(computeNextSelfAssessmentDate('2024-03-15', 2, 'weeks')).toBe('2024-03-29')
    expect(computeNextSelfAssessmentDate('2024-03-15', 1, 'months')).toBe('2024-04-15')
    expect(computeNextSelfAssessmentDate('2024-03-15', 1, 'years')).toBe('2025-03-15')
  })

  it('defaults to today when no from-date is given', () => {
    const now = new Date(Date.UTC(2024, 2, 5, 6, 0, 0))
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(computeNextSelfAssessmentDate(null, 1, 'weeks')).toBe(
      computeNextSelfAssessmentDate(expectedLocalDateString(now), 1, 'weeks')
    )
  })
})

describe('isSelfAssessmentDue', () => {
  it('is due once the next date is today or earlier, not due while still in the future', () => {
    const now = new Date(Date.UTC(2024, 2, 15, 6, 0, 0))
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const today = expectedLocalDateString(now)
    expect(isSelfAssessmentDue(today)).toBe(true)
    expect(isSelfAssessmentDue('2024-01-01')).toBe(true)
    expect(isSelfAssessmentDue('2999-01-01')).toBe(false)
  })

  it('returns false when there is no next date', () => {
    expect(isSelfAssessmentDue(null)).toBe(false)
  })
})
