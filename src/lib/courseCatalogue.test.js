import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: supabaseMock }))

const { formatCohortDateRange, respondToCourseAssignment } = await import('./courseCatalogue')

beforeEach(() => {
  supabaseMock.from.mockReset()
})

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

describe('respondToCourseAssignment', () => {
  it('returns the learner course created when an assignment is started', async () => {
    const learnerCourse = { id: 'learner-course-1', catalogue_course_id: 'catalogue-1' }
    supabaseMock.from.mockImplementation((table) => {
      if (table === 'courses') {
        return {
          insert: () => ({
            select() { return this },
            single: () => Promise.resolve({ data: learnerCourse, error: null }),
          }),
        }
      }
      return {
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    })

    const result = await respondToCourseAssignment('user-1', 'assignment-1', {
      enrol: true,
      courseForEnrolment: {
        id: 'catalogue-1',
        name: 'Leading well',
        provider: 'Acme',
        course_type: 'Online',
        duration: '30 minutes',
      },
    })

    expect(result).toEqual(learnerCourse)
  })
})
