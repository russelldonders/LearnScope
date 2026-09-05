import { describe, expect, it } from 'vitest'
import { buildCompositeProgress, calculateCompositeCoverage } from './skillCompositeProgress'

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

describe('buildCompositeProgress', () => {
  it('rolls completed nested subskills into their parent component', () => {
    const definitions = [
      {
        id: 'pizza-definition', parentSkillId: 'pizza', version: 1, components: [
          { id: 'dough-component', librarySkillId: 'dough', name: 'Dough making', targetLevel: 3, contributionWeight: 1, isRequired: true },
        ],
      },
      {
        id: 'dough-definition', parentSkillId: 'dough', version: 1, components: [
          { id: 'mixing-component', librarySkillId: 'mixing', name: 'Mixing dough', targetLevel: 2, contributionWeight: 1, isRequired: true },
          { id: 'stretching-component', librarySkillId: 'stretching', name: 'Stretching dough', targetLevel: 2, contributionWeight: 1, isRequired: true },
        ],
      },
    ]
    const tracked = new Map([
      ['mixing', { trackedSkillId: 'learner-mixing', currentLevel: 2 }],
      ['stretching', { trackedSkillId: 'learner-stretching', currentLevel: 2 }],
    ])

    const result = buildCompositeProgress(definitions, 'pizza', tracked)

    expect(result.coverage).toMatchObject({ percentage: 100, requiredMet: 1, allRequiredMet: true })
    expect(result.components[0]).toMatchObject({ currentLevel: null, targetMet: true, progressRatio: 1 })
    expect(result.components[0].childComposite.coverage.percentage).toBe(100)
  })

  it('uses direct achievement when it is stronger than partial nested coverage', () => {
    const definitions = [
      {
        id: 'parent-definition', parentSkillId: 'parent', version: 1, components: [
          { id: 'child-component', librarySkillId: 'child', name: 'Child', targetLevel: 4, contributionWeight: 1, isRequired: true },
        ],
      },
      {
        id: 'child-definition', parentSkillId: 'child', version: 1, components: [
          { id: 'leaf-component', librarySkillId: 'leaf', name: 'Leaf', targetLevel: 4, contributionWeight: 1, isRequired: true },
        ],
      },
    ]
    const tracked = new Map([
      ['child', { trackedSkillId: 'learner-child', currentLevel: 3 }],
      ['leaf', { trackedSkillId: 'learner-leaf', currentLevel: 1 }],
    ])

    expect(buildCompositeProgress(definitions, 'parent', tracked).coverage.percentage).toBe(75)
  })
})
