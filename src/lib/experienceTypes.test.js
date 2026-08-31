import { describe, expect, it } from 'vitest'
import { formatStudyDuration } from './experienceTypes'

describe('formatStudyDuration', () => {
  it('uses singular units for a duration of one', () => {
    expect(formatStudyDuration({ study_duration_value: 1, study_duration_unit: 'years' })).toBe('1 year')
  })

  it('uses plural units for longer durations', () => {
    expect(formatStudyDuration({ study_duration_value: 6, study_duration_unit: 'months' })).toBe('6 months')
  })

  it('keeps legacy free-text durations available', () => {
    expect(formatStudyDuration({ study_duration: 'One semester' })).toBe('One semester')
  })
})
