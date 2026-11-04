import { describe, expect, it } from 'vitest'
import { isDuplicateSkillNameError, skillNameKey, uniqueNewSkills } from './skillDuplicates'

describe('uniqueNewSkills', () => {
  it('drops repeats within the batch, ignoring case and surrounding spaces, keeping the first', () => {
    const result = uniqueNewSkills([
      { name: 'SQL', level: 3 },
      { name: ' sql ', level: 5 },
      { name: 'Python', level: 2 },
    ])
    expect(result).toEqual([{ name: 'SQL', level: 3 }, { name: 'Python', level: 2 }])
  })

  it('drops skills the learner already has', () => {
    const result = uniqueNewSkills([{ name: 'Facilitation' }, { name: 'Coaching' }], new Set(['facilitation']))
    expect(result.map((s) => s.name)).toEqual(['Coaching'])
  })

  it('trims the saved name and skips blank names', () => {
    expect(uniqueNewSkills([{ name: '  Leadership ' }, { name: '   ' }, { name: null }])).toEqual([{ name: 'Leadership' }])
  })

  it('does not change the existing-names set it was given', () => {
    const existing = new Set(['sql'])
    uniqueNewSkills([{ name: 'Python' }], existing)
    expect([...existing]).toEqual(['sql'])
  })
})

describe('skillNameKey', () => {
  it('matches how the unique index compares names after trimming', () => {
    expect(skillNameKey('  Project Management ')).toBe('project management')
  })
})

describe('isDuplicateSkillNameError', () => {
  it('recognises the per-learner unique name violation', () => {
    expect(isDuplicateSkillNameError({
      code: '23505', message: 'duplicate key value violates unique constraint "skills_user_id_name_lower_idx"',
    })).toBe(true)
    expect(isDuplicateSkillNameError({ code: '23505', message: 'other_idx' })).toBe(false)
  })
})
