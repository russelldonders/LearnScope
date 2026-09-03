import { describe, expect, it } from 'vitest'
import { computeRoleAlignment } from './roleAlignment'

describe('computeRoleAlignment', () => {
  const learnerSkills = [
    { skillId: 'skill-1', name: 'Facilitation', level: 4 },
    { skillId: 'skill-2', name: 'Stakeholder communication', level: 2 },
  ]

  it('treats a skill at or above the target level as aligned', () => {
    const { aligned, gaps } = computeRoleAlignment(learnerSkills, [
      { skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 },
    ])
    expect(aligned).toEqual([{ skillId: 'skill-1', name: 'Facilitation', targetLevel: 3, learnerLevel: 4 }])
    expect(gaps).toEqual([])
  })

  it('treats a skill exactly at the target level as aligned, not a gap', () => {
    const { aligned, gaps } = computeRoleAlignment(learnerSkills, [
      { skillId: 'skill-1', name: 'Facilitation', targetLevel: 4 },
    ])
    expect(aligned).toHaveLength(1)
    expect(gaps).toHaveLength(0)
  })

  it('treats a skill below the target level as a gap with the learner\'s current level', () => {
    const { aligned, gaps } = computeRoleAlignment(learnerSkills, [
      { skillId: 'skill-2', name: 'Stakeholder communication', targetLevel: 4 },
    ])
    expect(aligned).toEqual([])
    expect(gaps).toEqual([
      { skillId: 'skill-2', name: 'Stakeholder communication', targetLevel: 4, learnerLevel: 2 },
    ])
  })

  it('treats a skill the learner has never tracked as a gap with learnerLevel null', () => {
    const { gaps } = computeRoleAlignment(learnerSkills, [
      { skillId: 'skill-4', name: 'Incident response', targetLevel: 3 },
    ])
    expect(gaps).toEqual([{ skillId: 'skill-4', name: 'Incident response', targetLevel: 3, learnerLevel: null }])
  })

  it('never mutates the input arrays', () => {
    const skillsCopy = JSON.parse(JSON.stringify(learnerSkills))
    const required = [{ skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 }]
    const requiredCopy = JSON.parse(JSON.stringify(required))
    computeRoleAlignment(learnerSkills, required)
    expect(learnerSkills).toEqual(skillsCopy)
    expect(required).toEqual(requiredCopy)
  })
})
