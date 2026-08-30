import { describe, expect, it } from 'vitest'
import {
  buildStatement,
  relatedExperienceFromStatement,
  relatedSkillFromStatement,
} from './xapiStatement'

describe('skill activity context', () => {
  it('records both the skill and experience in the portable statement context', () => {
    const statement = buildStatement({
      actor: { name: 'Learner', email: 'learner@example.com' },
      verbValue: 'experienced',
      activityName: 'Solved a graph traversal problem',
      timestamp: '2026-08-30',
      relatedSkill: { id: 'skill-1', name: 'Algorithms' },
      relatedExperience: { id: 'experience-1', title: 'Computer Science', type: 'subject' },
    })

    expect(relatedSkillFromStatement(statement)).toEqual({ id: 'skill-1', name: 'Algorithms' })
    expect(relatedExperienceFromStatement(statement)).toEqual({
      id: 'experience-1',
      title: 'Computer Science',
      type: 'subject',
    })
  })
})
