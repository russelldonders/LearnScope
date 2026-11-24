import { describe, expect, it } from 'vitest'
import {
  PACKAGE_SESSION_EXTENSION_IRI,
  PROVENANCE_EXTENSION_IRI,
  SKILL_EXTENSION_IRI,
  buildSessionActivity,
  earnedNames,
} from './xapiPackageSession.js'
import * as client from '../../src/lib/xapiStatement'
import { goalReadings } from '../../src/lib/skillGoalProgress'

const session = {
  id: 'sess-1',
  user_id: 'user-1',
  skill_resource_id: 'res-1',
  created_at: '2026-11-18T10:00:00Z',
  summary_statement_id: 'sum-1',
}
const launched = 'https://learnscope.app/xapi/activities/res-1'
const row = (verb, object, receivedAt, result) => ({
  received_at: receivedAt,
  statement: { verb: { id: verb }, object, ...(result ? { result } : {}) },
})
const VERB = (name) => `http://adlnet.gov/expapi/verbs/${name}`
const EARNED = 'https://openbadgespec.org/xapi/verbs/earned'
const stamp = (name) => ({ id: `https://example.com/stamps/${name}`, definition: { name: { 'en-US': name } } })

describe('one activity per package session', () => {
  it('uses the same extension IRIs the app reads', () => {
    expect(SKILL_EXTENSION_IRI).toBe(client.SKILL_EXTENSION_IRI)
    expect(PROVENANCE_EXTENSION_IRI).toBe(client.PROVENANCE_EXTENSION_IRI)
    expect(PACKAGE_SESSION_EXTENSION_IRI).toBe(client.PACKAGE_SESSION_EXTENSION_IRI)
  })

  it('becomes the learner\'s activity on the skill: what, how long, how it went and what was earned', () => {
    const rows = [
      row(VERB('initialized'), { id: launched }, '2026-11-18T10:00:05Z'),
      row(EARNED, stamp('Gold stamp'), '2026-11-18T10:06:00Z'),
      row(EARNED, stamp('Bronze stamp'), '2026-11-18T10:08:00Z'),
      row(EARNED, stamp('Gold stamp'), '2026-11-18T10:09:00Z'),
      row(VERB('passed'), { id: launched, objectType: 'Activity' }, '2026-11-18T10:13:00Z', { score: { scaled: 0.85 } }),
      row(VERB('terminated'), { id: launched }, '2026-11-18T10:14:00Z'),
    ]
    const activity = buildSessionActivity({ session, rows, resourceTitle: 'Fire drill', skill: { id: 'skill-1', name: 'Safety' } })

    expect(activity).toMatchObject({
      id: 'sum-1', user_id: 'user-1', skill_id: 'skill-1', skill_resource_id: null, resource_id: null,
      launch_session_id: 'sess-1', recorded_at: '2026-11-18T10:00:00.000Z',
    })
    const { statement } = activity
    expect(statement.id).toBe('sum-1')
    expect(statement.verb.id).toBe(VERB('passed'))
    expect(client.activityName(statement)).toBe('Fire drill')
    expect(statement.object.definition.description['en-US']).toBe('Earned: Gold stamp, Bronze stamp')
    expect(statement.result).toEqual({ duration: 'PT14M', completion: true, success: true, score: { scaled: 0.85 } })
    expect(client.durationMinutes(statement)).toBe(14)
    expect(client.relatedSkillsFromStatement(statement)).toEqual([{ id: 'skill-1', name: 'Safety' }])
    expect(client.provenanceFromStatement(statement)).toEqual({ source: 'package', externalId: 'sess-1' })
    expect(client.packageSessionFromStatement(statement)).toEqual({
      resourceId: 'res-1', sessionId: 'sess-1', statementCount: 6, earned: ['Gold stamp', 'Bronze stamp'],
    })
  })

  it('counts once towards an activities goal, and its minutes towards practice time', () => {
    const rows = [row(VERB('initialized'), { id: launched }, '2026-11-18T10:00:00Z'), row(VERB('terminated'), { id: launched }, '2026-11-18T10:30:00Z')]
    const activity = buildSessionActivity({ session, rows, resourceTitle: 'Fire drill', skill: { id: 'skill-1', name: 'Safety' } })
    const asRow = { id: activity.id, recorded_at: activity.recorded_at, statement: activity.statement }
    expect(goalReadings({ measure_kind: 'activities' }, [asRow]).map((r) => r.value)).toEqual([1])
    expect(goalReadings({ measure_kind: 'practice_time' }, [asRow]).map((r) => r.value)).toEqual([30])
  })

  it('says "Did it" when nothing was finished, and leaves out a session shorter than a minute', () => {
    const rows = [row(VERB('initialized'), { id: launched }, '2026-11-18T10:00:20Z')]
    const { statement } = buildSessionActivity({ session, rows, resourceTitle: '  ', skill: null })
    expect(statement.verb.id).toBe(VERB('experienced'))
    expect(client.activityName(statement)).toBe('Course package')
    expect(statement.result).toBeUndefined()
    expect(statement.context.extensions[SKILL_EXTENSION_IRI]).toBeUndefined()
  })

  it('only counts a pass or fail of the launched package, not of one of its questions', () => {
    const rows = [
      row(VERB('passed'), { id: 'https://example.com/question-3' }, '2026-11-18T10:02:00Z'),
      row(VERB('failed'), { id: launched }, '2026-11-18T10:05:00Z'),
    ]
    const { statement } = buildSessionActivity({ session, rows, resourceTitle: 'Quiz' })
    expect(statement.verb.id).toBe(VERB('failed'))
    expect(statement.result.success).toBe(false)
  })

  it('times the session by when statements arrived, never beyond the session\'s 4 hours', () => {
    const rows = [row(VERB('initialized'), { id: launched }, '2026-11-20T10:00:00Z')]
    const { statement } = buildSessionActivity({ session, rows, resourceTitle: 'Long' })
    expect(statement.result.duration).toBe('PT4H')
    // A statement dated before the launch doesn't move its start.
    const early = buildSessionActivity({ session, rows: [row(VERB('initialized'), { id: launched }, '2020-01-01T00:00:00Z')], resourceTitle: 'Early' })
    expect(early.recorded_at).toBe('2026-11-18T10:00:00.000Z')
    expect(early.statement.result).toBeUndefined()
  })

  it('lists what was earned once each, by name', () => {
    expect(earnedNames([
      { verb: { id: EARNED }, object: stamp('A') },
      { verb: { id: 'http://id.tincanapi.com/verb/earned' }, object: stamp('B') },
      { verb: { id: EARNED }, object: stamp('A') },
      { verb: { id: EARNED }, object: { id: 'x' } },
      { verb: { id: VERB('completed') }, object: stamp('C') },
    ])).toEqual(['A', 'B'])
  })

  it('for a course lesson, says which lesson in which course, on no skill and off the course', () => {
    const lesson = { id: 'sess-2', user_id: 'user-1', skill_resource_id: null, resource_id: 'item-1', course_id: 'course-1', created_at: '2026-11-18T10:00:00Z', summary_statement_id: 'sum-2' }
    const lessonLaunched = 'https://learnscope.app/xapi/activities/item-1'
    const rows = [
      row(VERB('initialized'), { id: lessonLaunched }, '2026-11-18T10:00:05Z'),
      row(VERB('completed'), { id: lessonLaunched }, '2026-11-18T10:20:00Z'),
    ]
    const activity = buildSessionActivity({ session: lesson, rows, resourceTitle: 'Manual handling' })
    expect(activity).toMatchObject({ id: 'sum-2', skill_id: null, skill_resource_id: null, resource_id: null, launch_session_id: 'sess-2' })
    expect(activity).not.toHaveProperty('course_id')
    expect(activity.statement.verb.id).toBe(VERB('completed'))
    expect(client.activityName(activity.statement)).toBe('Manual handling')
    expect(client.relatedSkillsFromStatement(activity.statement)).toEqual([])
    expect(client.packageSessionFromStatement(activity.statement)).toEqual({
      courseItemId: 'item-1', courseId: 'course-1', sessionId: 'sess-2', statementCount: 2, earned: [],
    })
  })
})
