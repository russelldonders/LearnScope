import { describe, expect, it } from 'vitest'
import { completionFromStatements, launchedActivityId, shouldRecord } from './xapiCompletion.js'

const activity = launchedActivityId('res-1')
const verb = (name) => ({ id: `http://adlnet.gov/expapi/verbs/${name}` })

describe('completionFromStatements', () => {
  it('uses the launch activity id LearnScope gives the package', () => {
    expect(activity).toBe('https://learnscope.app/xapi/activities/res-1')
  })

  it('counts completed and passed statements about the launched activity', () => {
    expect(completionFromStatements([{ verb: verb('completed'), object: { id: activity } }], activity))
      .toEqual({ status: 'completed', score: null })
    expect(completionFromStatements([{ verb: verb('passed'), object: { id: activity, objectType: 'Activity' }, result: { score: { scaled: 0.85 } } }], activity))
      .toEqual({ status: 'passed', score: 85 })
  })

  it('prefers a pass over a completion in the same batch', () => {
    const statements = [
      { verb: verb('completed'), object: { id: activity } },
      { verb: verb('passed'), object: { id: activity }, result: { score: { raw: 8, max: 10 } } },
    ]
    expect(completionFromStatements(statements, activity)).toEqual({ status: 'passed', score: 80 })
  })

  it('ignores sub-activities, other verbs and failures', () => {
    expect(completionFromStatements([
      { verb: verb('completed'), object: { id: `${activity}/question-3` } },
      { verb: verb('experienced'), object: { id: activity } },
      { verb: verb('failed'), object: { id: activity } },
      { verb: verb('completed'), object: { id: activity, objectType: 'Agent' } },
    ], activity)).toBeNull()
  })

  it('copes with malformed statements', () => {
    expect(completionFromStatements([null, {}, { verb: null, object: null }], activity)).toBeNull()
  })
})

describe('shouldRecord', () => {
  it('records only an improvement', () => {
    expect(shouldRecord({ status: 'completed' }, undefined)).toBe(true)
    expect(shouldRecord({ status: 'completed' }, 'incomplete')).toBe(true)
    expect(shouldRecord({ status: 'passed' }, 'completed')).toBe(true)
    expect(shouldRecord({ status: 'completed' }, 'completed')).toBe(false)
    expect(shouldRecord({ status: 'completed' }, 'passed')).toBe(false)
    expect(shouldRecord(null, undefined)).toBe(false)
  })
})
