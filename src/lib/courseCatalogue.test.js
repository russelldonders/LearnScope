import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const { formatCohortDateRange } = await import('./courseCatalogue')

describe('formatCohortDateRange', () => {
  it('reports no dates set when neither is given', () => {
    expect(formatCohortDateRange(null, null)).toBe('No dates set')
  })

  it('shows a plain date for a same-day cohort with no time entered on either end', () => {
    expect(formatCohortDateRange('2026-10-01T00:00:00', '2026-10-01T00:00:00')).toBe('1 Oct 2026')
  })

  it('shows a date and time range for a same-day cohort with times set', () => {
    const result = formatCohortDateRange('2026-10-01T09:00:00', '2026-10-01T17:00:00')
    expect(result).toContain('1 Oct 2026')
    expect(result).toContain('–')
  })

  it('shows a plain date range across days when neither end has a time', () => {
    expect(formatCohortDateRange('2026-10-01T00:00:00', '2026-10-05T00:00:00')).toBe('1 Oct 2026 – 5 Oct 2026')
  })

  it('includes the time for whichever end actually has one, across days', () => {
    const result = formatCohortDateRange('2026-10-01T00:00:00', '2026-10-05T15:30:00')
    expect(result).toContain('1 Oct 2026 –')
    expect(result).not.toContain('1 Oct 2026,')
    expect(result).toContain('5 Oct 2026,')
  })

  it('shows only a start when there is no end date, omitting time if none was set', () => {
    expect(formatCohortDateRange('2026-10-01T00:00:00', null)).toBe('Starts 1 Oct 2026')
  })

  it('shows only an end when there is no start date', () => {
    expect(formatCohortDateRange(null, '2026-10-05T00:00:00')).toBe('Ends 5 Oct 2026')
  })
})
