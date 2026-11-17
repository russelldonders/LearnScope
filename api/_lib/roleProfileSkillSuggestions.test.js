import { describe, expect, it } from 'vitest'
import {
  buildRoleProfileSkillSuggestionRequest,
  normalizeRoleProfileSkillSuggestions,
} from './roleProfileSkillSuggestions.js'

describe('buildRoleProfileSkillSuggestionRequest', () => {
  it('requires a role name', () => {
    expect(buildRoleProfileSkillSuggestionRequest({ roleName: '  ' })).toEqual({ error: 'Missing roleName' })
  })

  it('includes the role, existing skills and exclusions in the prompt', () => {
    const request = buildRoleProfileSkillSuggestionRequest({
      roleName: 'Support Lead',
      roleDescription: 'Leads the support desk',
      existingSkillNames: ['Facilitation', 'facilitation', 'Incident response'],
      excludedSkillNames: ['Coaching'],
    })
    expect(request.existing).toEqual(['Facilitation', 'Incident response'])
    expect(request.excluded).toEqual(['Coaching'])
    expect(request.prompt).toContain('Role name: Support Lead')
    expect(request.prompt).toContain('Leads the support desk')
    expect(request.prompt).toContain('Facilitation, Incident response')
    expect(request.prompt).toContain('Coaching')
  })
})

describe('normalizeRoleProfileSkillSuggestions', () => {
  const request = buildRoleProfileSkillSuggestionRequest({
    roleName: 'Support Lead',
    existingSkillNames: ['Incident response', 'Facilitation'],
    excludedSkillNames: ['Coaching'],
  })

  it('reuses existing skills by canonical name and lists them before new ones', () => {
    const result = normalizeRoleProfileSkillSuggestions({
      recommendations: [
        { name: 'Queue management', reason: 'Keeps tickets moving.', targetLevel: 3 },
        { name: 'incident RESPONSE', reason: 'Handles outages.', targetLevel: 4 },
      ],
    }, request)
    expect(result).toEqual([
      { name: 'Incident response', reason: 'Handles outages.', targetLevel: 4, isExisting: true },
      { name: 'Queue management', reason: 'Keeps tickets moving.', targetLevel: 3, isExisting: false },
    ])
  })

  it('drops excluded, duplicate and incomplete suggestions and clamps bad levels', () => {
    const result = normalizeRoleProfileSkillSuggestions({
      recommendations: [
        { name: 'coaching', reason: 'Excluded.', targetLevel: 3 },
        { name: 'Facilitation', reason: 'Runs sessions.', targetLevel: 9 },
        { name: 'facilitation', reason: 'Duplicate.', targetLevel: 2 },
        { name: 'Empathy', reason: '', targetLevel: 2 },
      ],
    }, request)
    expect(result).toEqual([
      { name: 'Facilitation', reason: 'Runs sessions.', targetLevel: 3, isExisting: true },
    ])
  })

  it('returns at most five suggestions', () => {
    const recommendations = Array.from({ length: 8 }, (_, i) => ({ name: `Skill ${i}`, reason: 'Fits.', targetLevel: 2 }))
    expect(normalizeRoleProfileSkillSuggestions({ recommendations }, request)).toHaveLength(5)
  })
})
