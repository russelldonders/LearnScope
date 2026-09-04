import { describe, expect, it } from 'vitest'
import { calculateCompositeCoverage } from './skillCompositeProgress'

function component({ level, target = 3, weight = 1, required = true }) {
  return {
    currentLevel: level,
    targetLevel: target,
    contributionWeight: weight,
    isRequired: required,
    targetMet: level != null && level >= target,
  }
}

describe('calculateCompositeCoverage', () => {
  it('calculates weighted progress and caps achievement at each target', () => {
    const result = calculateCompositeCoverage([
      component({ level: 3, target: 3, weight: 2 }),
      component({ level: 1, target: 2, weight: 1 }),
    ])

    expect(result.percentage).toBe(83)
    expect(result.requiredMet).toBe(1)
    expect(result.requiredTotal).toBe(2)
    expect(result.allRequiredMet).toBe(false)
  })

  it('includes optional components in coverage without treating them as required', () => {
    const result = calculateCompositeCoverage([
      component({ level: 3, target: 3 }),
      component({ level: 0, target: 3, required: false }),
    ])

    expect(result.percentage).toBe(50)
    expect(result.requiredMet).toBe(1)
    expect(result.requiredTotal).toBe(1)
    expect(result.allRequiredMet).toBe(true)
  })

  it('returns zero coverage for an empty definition', () => {
    expect(calculateCompositeCoverage([])).toEqual({
      percentage: 0,
      requiredMet: 0,
      requiredTotal: 0,
      allRequiredMet: true,
    })
  })
})
