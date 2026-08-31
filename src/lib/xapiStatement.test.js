import { describe, expect, it } from 'vitest'
import {
  buildStatement,
  experienceTrail,
  provenanceFromStatement,
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

  it('carries the parent education/job alongside a subject or project so the trail survives on the statement', () => {
    const statement = buildStatement({
      actor: { name: 'Learner', email: 'learner@example.com' },
      verbValue: 'experienced',
      activityName: 'Solved a graph traversal problem',
      timestamp: '2026-08-30',
      relatedSkill: { id: 'skill-1', name: 'Algorithms' },
      relatedExperience: {
        id: 'experience-1',
        title: 'Advanced Databases',
        type: 'subject',
        parent: { id: 'experience-0', title: 'Computer Science BSc', type: 'education' },
      },
    })

    const relatedExperience = relatedExperienceFromStatement(statement)
    expect(relatedExperience.parent).toEqual({ id: 'experience-0', title: 'Computer Science BSc', type: 'education' })
    expect(experienceTrail(relatedExperience)).toBe('Advanced Databases · Computer Science BSc')
  })
})

describe('provenance', () => {
  it('marks a statement as synced from an external source and carries its external id', () => {
    const statement = buildStatement({
      actor: { name: 'Learner', email: 'learner@example.com' },
      verbValue: 'practiced',
      activityName: 'Morning run',
      timestamp: '2026-08-30',
      relatedSkill: { id: 'skill-1', name: 'Running' },
      provenance: { source: 'strava', externalId: '123456789' },
    })

    expect(provenanceFromStatement(statement)).toEqual({ source: 'strava', externalId: '123456789' })
  })

  it('is absent when no provenance was supplied, so manually logged statements are unaffected', () => {
    const statement = buildStatement({
      actor: { name: 'Learner', email: 'learner@example.com' },
      verbValue: 'experienced',
      activityName: 'Solved a graph traversal problem',
      timestamp: '2026-08-30',
      relatedSkill: { id: 'skill-1', name: 'Algorithms' },
    })

    expect(provenanceFromStatement(statement)).toBeNull()
  })
})

describe('experienceTrail', () => {
  it('falls back to just the title when there is no parent', () => {
    expect(experienceTrail({ title: 'Freelance web build', type: 'project' })).toBe('Freelance web build')
  })

  it('returns an empty string when there is no related experience', () => {
    expect(experienceTrail(null)).toBe('')
  })
})
