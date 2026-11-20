import { describe, expect, it } from 'vitest'
import { scoreTestQuestion } from '../../src/lib/pageBuilder'
import { cleanAnswer, diagnoseLevel, markAnswer, nextRoundLevel, questionForLearner } from './knowledgeCheck.js'

const item = (id, label, extra = {}) => ({ id, label, detail: '', value: 0, correct: false, ...extra })
const q = (layout, items, extra = {}) => ({ id: `q-${layout}`, type: 'test_question', title: `A ${layout} question`, layout, points: 1, tolerance: 0, caption: 'Why.', items, ...extra })

const QUESTIONS = {
  single: q('single', [item('a', 'A', { correct: true }), item('b', 'B')]),
  multiple: q('multiple', [item('a', 'A', { correct: true }), item('b', 'B', { correct: true }), item('c', 'C')]),
  true_false: q('true_false', [item('t', 'True'), item('f', 'False', { correct: true })]),
  short_text: q('short_text', [item('x', 'Paris'), item('y', 'paris city')]),
  number: q('number', [item('n', '', { value: 42 })], { tolerance: 0.5 }),
  ordering: q('ordering', [item('1', 'First'), item('2', 'Second'), item('3', 'Third')]),
  matching: q('matching', [item('m1', 'Line', { detail: 'Time' }), item('m2', 'Scatter', { detail: 'Relationship' })]),
}

// Every answer here is checked against the course player's own marking, so
// the server can't drift from what the course builder means by "right".
const ANSWERS = {
  single: ['a', 'b'],
  multiple: [['a', 'b'], ['b', 'a'], ['a'], ['a', 'b', 'c']],
  true_false: ['f', 't'],
  short_text: ['Paris', '  paris ', 'paris city', 'London'],
  number: ['42', '42.4', '43', 'abc'],
  ordering: [['1', '2', '3'], ['2', '1', '3']],
  matching: [{ m1: 'Time', m2: 'Relationship' }, { m1: 'Relationship', m2: 'Time' }],
}

describe('markAnswer', () => {
  for (const [layout, answers] of Object.entries(ANSWERS)) {
    it(`marks ${layout} exactly as the course player does`, () => {
      for (const answer of answers) {
        expect(markAnswer(QUESTIONS[layout], answer)).toBe(scoreTestQuestion(QUESTIONS[layout], answer).correct)
      }
    })
  }
})

describe('questionForLearner', () => {
  it('never sends answers, accepted answers, numbers, order, matches or the explanation', () => {
    for (const question of Object.values(QUESTIONS)) {
      const shown = questionForLearner(question, () => 0.3)
      const text = JSON.stringify(shown)
      expect(text).not.toContain('"correct"')
      expect(text).not.toContain('Why.')
      expect(shown).not.toHaveProperty('caption')
      expect(shown).not.toHaveProperty('tolerance')
      if (question.layout === 'short_text') expect(text).not.toContain('Paris')
      if (question.layout === 'number') expect(text).not.toContain('42')
      if (question.layout === 'matching') {
        expect(shown.items.every((i) => !('detail' in i))).toBe(true)
        expect([...shown.options].sort()).toEqual(['Relationship', 'Time'])
      }
    }
  })

  it('mixes up an ordering question so it never arrives already right', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const shown = questionForLearner(QUESTIONS.ordering, () => r)
      expect(shown.items.map((i) => i.id)).not.toEqual(['1', '2', '3'])
    }
  })
})

describe('cleanAnswer', () => {
  it('accepts answers in the shape the question takes', () => {
    expect(cleanAnswer(QUESTIONS.single, 'a')).toBe('a')
    expect(cleanAnswer(QUESTIONS.multiple, ['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(cleanAnswer(QUESTIONS.ordering, ['3', '1', '2'])).toEqual(['3', '1', '2'])
    expect(cleanAnswer(QUESTIONS.matching, { m1: 'Time', m2: 'Time' })).toEqual({ m1: 'Time', m2: 'Time' })
    expect(cleanAnswer(QUESTIONS.number, 7)).toBe('7')
  })

  it('rejects anything else', () => {
    expect(cleanAnswer(QUESTIONS.single, 'zzz')).toBeNull()
    expect(cleanAnswer(QUESTIONS.multiple, [])).toBeNull()
    expect(cleanAnswer(QUESTIONS.ordering, ['1', '2'])).toBeNull()
    expect(cleanAnswer(QUESTIONS.matching, { m1: 'Time' })).toBeNull()
    expect(cleanAnswer(QUESTIONS.number, 'abc')).toBeNull()
    expect(cleanAnswer(QUESTIONS.short_text, '   ')).toBeNull()
  })
})

describe('diagnoseLevel', () => {
  const r = (level, passed) => ({ level, passed })

  it('confirms a passed level, or steps down one on a fail', () => {
    expect(diagnoseLevel({ calibrate: false, rounds: [r(4, true)] })).toBe(4)
    expect(diagnoseLevel({ calibrate: false, rounds: [r(4, false)] })).toBe(3)
    expect(diagnoseLevel({ calibrate: false, rounds: [r(1, false)] })).toBe(1)
    expect(diagnoseLevel({ calibrate: false, rounds: [r(4, true), r(5, true)] })).toBeNull()
  })

  it('follows the calibration walk from level 3', () => {
    expect(diagnoseLevel({ calibrate: true, rounds: [r(3, true), r(4, false)] })).toBe(3)
    expect(diagnoseLevel({ calibrate: true, rounds: [r(3, true), r(4, true), r(5, true)] })).toBe(5)
    expect(diagnoseLevel({ calibrate: true, rounds: [r(3, false), r(2, true)] })).toBe(2)
    expect(diagnoseLevel({ calibrate: true, rounds: [r(3, false), r(2, false), r(1, false)] })).toBe(1)
  })

  it('refuses rounds that aren’t a real, finished walk', () => {
    expect(diagnoseLevel({ calibrate: true, rounds: [r(5, true)] })).toBeNull() // didn't start at 3
    expect(diagnoseLevel({ calibrate: true, rounds: [r(3, true), r(5, true)] })).toBeNull() // skipped a level
    expect(diagnoseLevel({ calibrate: true, rounds: [r(3, true)] })).toBeNull() // stopped early
    expect(diagnoseLevel({ calibrate: true, rounds: [r(3, true), r(4, false), r(3, true)] })).toBeNull() // kept going
  })
})

describe('nextRoundLevel', () => {
  const r = (level, passed) => ({ level, passed })
  it('leads a calibration run up or down a level until it has its answer', () => {
    expect(nextRoundLevel({ calibrate: true, rounds: [r(3, true)] })).toBe(4)
    expect(nextRoundLevel({ calibrate: true, rounds: [r(3, false)] })).toBe(2)
    expect(nextRoundLevel({ calibrate: true, rounds: [r(3, true), r(4, false)] })).toBeNull()
    expect(nextRoundLevel({ calibrate: true, rounds: [r(3, false), r(2, false)] })).toBe(1)
  })
  it('never continues a confirming run', () => {
    expect(nextRoundLevel({ calibrate: false, rounds: [r(4, false)] })).toBeNull()
  })
})

describe('choice order', () => {
  it('is reshuffled for every learner, except true/false', () => {
    const first = questionForLearner(QUESTIONS.multiple, () => 0).items.map((i) => i.id)
    const second = questionForLearner(QUESTIONS.multiple, () => 0.99).items.map((i) => i.id)
    expect(first).not.toEqual(second)
    expect(questionForLearner(QUESTIONS.true_false, () => 0).items.map((i) => i.label)).toEqual(['True', 'False'])
  })
})
