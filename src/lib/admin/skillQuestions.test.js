import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({ supabase: {} }))
const { prepareSkillQuestion } = await import('./skillQuestions')

const item = (label, extra = {}) => ({ id: label, label, detail: '', value: 0, correct: false, ...extra })

describe('prepareSkillQuestion', () => {
  it('accepts a valid single-answer question and stores it as one point', () => {
    const { question, error } = prepareSkillQuestion({
      type: 'test_question',
      title: 'Pick one',
      layout: 'single',
      points: 5,
      items: [item('A', { correct: true }), item('B')],
    })
    expect(error).toBeUndefined()
    expect(question).toEqual(expect.objectContaining({ type: 'test_question', layout: 'single', points: 1 }))
  })

  it('explains what is missing', () => {
    expect(prepareSkillQuestion({ type: 'test_question', title: '', layout: 'single', items: [] }).error).toBe('Write the question.')
    expect(
      prepareSkillQuestion({ type: 'test_question', title: 'Q', layout: 'single', items: [item('A', { correct: true }), item('B', { correct: true })] }).error
    ).toBe('Mark exactly one answer as right.')
    expect(
      prepareSkillQuestion({ type: 'test_question', title: 'Q', layout: 'multiple', items: [item('A', { correct: true }), item('B', { correct: true })] }).error
    ).toBe('At least one answer must be wrong.')
    expect(
      prepareSkillQuestion({ type: 'test_question', title: 'Q', layout: 'matching', items: [item('A', { detail: '1' }), item('B')] }).error
    ).toBe('Every pair needs both sides.')
  })
})
