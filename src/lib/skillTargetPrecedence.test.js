import { describe, expect, it } from 'vitest'
import { computeVisibleTarget } from './skillTargetPrecedence'

describe('computeVisibleTarget', () => {
  it('returns null when neither an employer nor a personal target exists', () => {
    expect(computeVisibleTarget({})).toBeNull()
  })

  it('falls back to the personal target when there is no employer target', () => {
    expect(computeVisibleTarget({ personalTargetLevel: 3 })).toEqual({
      level: 3,
      source: 'personal',
      employerTargetLevel: null,
      employerTargetMet: false,
    })
  })

  it('shows the employer target when there is no personal target', () => {
    expect(computeVisibleTarget({ employerTargetLevel: 4 })).toEqual({
      level: 4,
      source: 'employer',
      employerTargetLevel: 4,
      employerTargetMet: false,
    })
  })

  it('keeps the employer target visible while unmet, even with a self-assessed level that would clear it', () => {
    // employerConfirmedLevel is the employer-confirmed level, not a self-assessment --
    // an unconfirmed self-assessed level must never satisfy an employer target.
    expect(computeVisibleTarget({ employerTargetLevel: 4, personalTargetLevel: 5 })).toEqual({
      level: 4,
      source: 'employer',
      employerTargetLevel: 4,
      employerTargetMet: false,
    })
  })

  it('keeps the employer target visible once met when there is no higher personal target', () => {
    expect(computeVisibleTarget({ employerTargetLevel: 4, employerConfirmedLevel: 4 })).toEqual({
      level: 4,
      source: 'employer',
      employerTargetLevel: 4,
      employerTargetMet: true,
    })
  })

  it('switches to the higher personal target once the employer target is confirmed met', () => {
    expect(computeVisibleTarget({ employerTargetLevel: 3, employerConfirmedLevel: 3, personalTargetLevel: 5 })).toEqual({
      level: 5,
      source: 'personal',
      employerTargetLevel: 3,
      employerTargetMet: true,
    })
  })

  it('does not switch to a lower personal target once the employer target is met', () => {
    expect(computeVisibleTarget({ employerTargetLevel: 4, employerConfirmedLevel: 4, personalTargetLevel: 2 })).toEqual({
      level: 4,
      source: 'employer',
      employerTargetLevel: 4,
      employerTargetMet: true,
    })
  })
})
