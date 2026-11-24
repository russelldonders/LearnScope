import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const { coachingOnSkill, sessionActivityStatement } = await import('./coaching')
const { durationMinutes, relatedSkillsFromStatement, SHARED_WITH_EXTENSION_IRI } = await import('./xapiStatement')

describe('coachingOnSkill', () => {
  it('splits coaching on a skill into the learner side and the coach side', () => {
    const rows = [
      { id: 'a', role: 'learner', learner_skill_id: 's1' },
      { id: 'b', role: 'coach', coach_skill_id: 's1' },
      { id: 'c', role: 'learner', learner_skill_id: 's2' },
    ]
    expect(coachingOnSkill(rows, 's1')).toEqual({ asLearner: [rows[0]], asCoach: [rows[1]] })
  })
})

describe('sessionActivityStatement', () => {
  it('records a session as done together with the coach, on the learner\'s skill, when it started and as long as it lasted', () => {
    const statement = sessionActivityStatement({
      session: { starts_at: '2026-11-24T10:00:00.000Z', duration_minutes: 90, agenda: 'Workshop plan' },
      relationship: { learner_skill_id: 'mine', skill_name: 'Facilitation', library_skill_id: 'lib', other_name: 'Coral' },
      actor: { name: 'Me', email: 'me@example.com' },
      title: 'Coaching session with Coral',
    })
    expect(statement.object.definition.name['en-US']).toBe('Coaching session with Coral')
    expect(statement.timestamp).toBe('2026-11-24T10:00:00.000Z')
    expect(durationMinutes(statement)).toBe(90)
    expect(relatedSkillsFromStatement(statement)).toEqual([{ id: 'mine', name: 'Facilitation' }])
    expect(statement.context.extensions[SHARED_WITH_EXTENSION_IRI]).toMatchObject({ name: 'Coral', kind: 'joint' })
    // The agenda stands in for a note the learner didn't write.
    expect(statement.object.definition.description['en-US']).toBe('Workshop plan')
  })
})
