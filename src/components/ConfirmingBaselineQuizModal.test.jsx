import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Two pool questions per round, as the course builder's scored questions:
// one single-answer, one true/false. "Right" / "True" are always correct.
function questionsFor(level) {
  return [
    {
      id: `L${level}-q1`,
      type: 'test_question',
      title: `Question one at ${level}`,
      layout: 'single',
      points: 1,
      tolerance: 0,
      caption: 'Because it is.',
      items: [
        { id: 'r', label: 'Right', detail: '', value: 0, correct: true },
        { id: 'w', label: 'Wrong', detail: '', value: 0, correct: false },
      ],
    },
    {
      id: `L${level}-q2`,
      type: 'test_question',
      title: `Question two at ${level}`,
      layout: 'true_false',
      points: 1,
      tolerance: 0,
      caption: '',
      items: [
        { id: 't', label: 'True', detail: '', value: 0, correct: true },
        { id: 'f', label: 'False', detail: '', value: 0, correct: false },
      ],
    },
  ]
}

const inserts = []
const updates = []
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    from: (table) => ({
      insert: (row) => {
        inserts.push({ table, row })
        return Promise.resolve({ error: null })
      },
      update: (row) => ({
        eq: () => {
          updates.push({ table, row })
          return Promise.resolve({ error: null })
        },
      }),
    }),
  },
}))
const fetchQuestions = vi.fn(({ level }) => Promise.resolve({ questions: questionsFor(level) }))
const saveAttempt = vi.fn(() => Promise.resolve({ score: 0, total: 2 }))
vi.mock('../lib/skillDiagnostics', () => ({
  fetchKnowledgeCheckQuestions: (...a) => fetchQuestions(...a),
  saveDiagnosticAttempt: (...a) => saveAttempt(...a),
}))
vi.mock('./GrowthRing', () => ({ default: () => null }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: ConfirmingBaselineQuizModal } = await import('./ConfirmingBaselineQuizModal')

beforeEach(() => {
  inserts.length = 0
  updates.length = 0
  fetchQuestions.mockClear()
  saveAttempt.mockClear()
})
afterEach(cleanup)

function renderQuiz(props = {}) {
  const onClose = vi.fn()
  const onConfirmed = vi.fn()
  render(
    <ConfirmingBaselineQuizModal
      skill={{ id: 's1', name: 'Weight loss', knowledge_level: 3, lifecycle_stage: 'identified', library_skill_id: 'lib1' }}
      user={{ id: 'me' }}
      actor={{ name: 'Me', email: 'me@example.com' }}
      latestKnowledgeAssessment={{ level: 3 }}
      onClose={onClose}
      onConfirmed={onConfirmed}
      {...props}
    />
  )
  return { onClose, onConfirmed }
}

async function start(name = "Let's go") {
  const button = await screen.findByRole('button', { name })
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
}

async function answerRound(right) {
  await screen.findByText('Question 1 of 2')
  fireEvent.click(screen.getByLabelText(right ? 'Right' : 'Wrong', { exact: false }))
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Question 2 of 2')
  fireEvent.click(screen.getByLabelText(right ? 'True' : 'False', { exact: false }))
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
}

describe('the knowledge check', () => {
  it('opens on an intro, then shows feedback after each checked answer', async () => {
    renderQuiz()
    expect(await screen.findByText('Quick check: Weight loss')).toBeTruthy()
    await start()
    expect(screen.getByText('Question one at 3')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Wrong', { exact: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByText('Not quite.')).toBeTruthy()
    expect(screen.getByText('Because it is.')).toBeTruthy()
  })

  it('confirms the pitched level on a pass and records exactly what was asked', async () => {
    renderQuiz()
    await start()
    await answerRound(true)

    await screen.findByText('Saved as your knowledge level for this skill.')
    expect(screen.getByText('Confirmed!')).toBeTruthy()
    expect(saveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        calibratedLevel: 3,
        confirmedLevel: 3,
        questions: questionsFor(3),
        answers: { 'L3-q1': 'r', 'L3-q2': 't' },
        results: expect.objectContaining({ 'L3-q1': expect.objectContaining({ correct: true }) }),
      })
    )
    expect(inserts[0].row).toEqual(expect.objectContaining({ level: 3, source: 'diagnostic_confirmed' }))
  })

  it('steps down a level, without celebrating, on a fail', async () => {
    renderQuiz()
    await start()
    await answerRound(false)
    await screen.findByText('Saved as your knowledge level for this skill.')
    expect(screen.getByText("Here's where you landed")).toBeTruthy()
    expect(updates).toEqual([{ table: 'skills', row: { knowledge_level: 2 } }])
  })
})

describe('a knowledge check with no self-assessment to start from', () => {
  it('finds the level and saves it as the skill’s knowledge level without needing Continue', async () => {
    const { onClose, onConfirmed } = renderQuiz({
      skill: { id: 's1', name: 'Weight loss', knowledge_level: null, lifecycle_stage: 'identified', library_skill_id: 'lib1' },
      latestKnowledgeAssessment: null,
      calibrating: true,
    })

    // Passes level 3, then fails level 4: lands on 3.
    await start()
    await answerRound(true)
    expect(await screen.findByText('Nicely done!')).toBeTruthy()
    await start('Next round →')
    await answerRound(false)

    await screen.findByText('Saved as your knowledge level for this skill.')
    expect(fetchQuestions.mock.calls.map(([args]) => args.level)).toEqual([3, 4])
    expect(inserts).toEqual([
      expect.objectContaining({
        table: 'skill_assessments',
        row: expect.objectContaining({ level: 3, axis: 'knowledge', source: 'diagnostic_confirmed' }),
      }),
    ])
    expect(updates).toEqual([{ table: 'skills', row: { knowledge_level: 3 } }])

    // Closing it any way now reloads the page to show the level.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })
})
