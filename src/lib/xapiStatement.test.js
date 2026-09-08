import { describe, expect, it } from 'vitest'
import {
  buildStatement,
  durationMinutes,
  experienceTrail,
  formatDuration,
  formatMinutes,
  provenanceFromStatement,
  relatedExperienceFromStatement,
  relatedSkillsFromStatement,
  SKILL_EXTENSION_IRI,
} from './xapiStatement'

describe('skill activity context', () => {
  it('records both the skill and experience in the portable statement context', () => {
    const statement = buildStatement({
      actor: { name: 'Learner', email: 'learner@example.com' },
      verbValue: 'experienced',
      activityName: 'Solved a graph traversal problem',
      timestamp: '2026-08-30',
      relatedSkills: [{ id: 'skill-1', name: 'Algorithms' }],
      relatedExperience: { id: 'experience-1', title: 'Computer Science', type: 'subject' },
    })

    expect(relatedSkillsFromStatement(statement)).toEqual([{ id: 'skill-1', name: 'Algorithms' }])
    expect(relatedExperienceFromStatement(statement)).toEqual({
      id: 'experience-1',
      title: 'Computer Science',
      type: 'subject',
    })
  })

  it('records every related skill when more than one is picked', () => {
    const statement = buildStatement({
      actor: { name: 'Learner', email: 'learner@example.com' },
      verbValue: 'experienced',
      activityName: 'Ran a retro for the team',
      timestamp: '2026-08-30',
      relatedSkills: [
        { id: 'skill-1', name: 'Facilitation' },
        { id: 'skill-2', name: 'Communication' },
      ],
    })

    expect(relatedSkillsFromStatement(statement)).toEqual([
      { id: 'skill-1', name: 'Facilitation' },
      { id: 'skill-2', name: 'Communication' },
    ])
  })

  it('normalizes a pre-multi-skill statement (a single object, not an array) to an array', () => {
    const legacyStatement = {
      context: { extensions: { [SKILL_EXTENSION_IRI]: { id: 'skill-1', name: 'Algorithms' } } },
    }
    expect(relatedSkillsFromStatement(legacyStatement)).toEqual([{ id: 'skill-1', name: 'Algorithms' }])
  })

  it('returns an empty array when no skill is related', () => {
    expect(relatedSkillsFromStatement({})).toEqual([])
  })

  it('carries the parent education/job alongside a subject or project so the trail survives on the statement', () => {
    const statement = buildStatement({
      actor: { name: 'Learner', email: 'learner@example.com' },
      verbValue: 'experienced',
      activityName: 'Solved a graph traversal problem',
      timestamp: '2026-08-30',
      relatedSkills: [{ id: 'skill-1', name: 'Algorithms' }],
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
      relatedSkills: [{ id: 'skill-1', name: 'Running' }],
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
      relatedSkills: [{ id: 'skill-1', name: 'Algorithms' }],
    })

    expect(provenanceFromStatement(statement)).toBeNull()
  })
})

describe('duration', () => {
  it('parses a statement duration into total minutes', () => {
    expect(durationMinutes({ result: { duration: 'PT1H30M' } })).toBe(90)
    expect(durationMinutes({ result: { duration: 'PT45M' } })).toBe(45)
    expect(durationMinutes({ result: { duration: 'PT2H' } })).toBe(120)
  })

  it('is zero when there is no duration or it does not parse', () => {
    expect(durationMinutes({})).toBe(0)
    expect(durationMinutes({ result: { duration: 'garbage' } })).toBe(0)
  })

  it('formats a raw minute total the same way formatDuration formats a single statement', () => {
    expect(formatMinutes(90)).toBe('1h 30m')
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(120)).toBe('2h')
    expect(formatMinutes(0)).toBeNull()
    expect(formatDuration({ result: { duration: 'PT1H30M' } })).toBe('1h 30m')
    expect(formatDuration({})).toBeNull()
  })

  it('sums durations across several statements for a grouped Timeline summary', () => {
    const statements = [
      { result: { duration: 'PT35M' } },
      { result: { duration: 'PT17M' } },
      {},
    ]
    const total = statements.reduce((sum, s) => sum + durationMinutes(s), 0)
    expect(formatMinutes(total)).toBe('52m')
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
