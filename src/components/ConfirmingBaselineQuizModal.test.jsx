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

// What the learner is sent: the questions without their answers.
function withoutAnswers(question) {
  return { id: question.id, type: question.type, title: question.title, layout: question.layout, points: 1, items: question.items.map(({ id, label }) => ({ id, label })) }
}

// A stand-in for the server, marking answers against the full questions.
// The server decides each round's level: 3 to start, then up or down a
// level from the last round's result when calibrating.
const marked = {}
let settledLevel = null
let serverCalibrates = false
let lastAttempt = null
const startCheck = vi.fn(({ runId }) => {
  const level = runId ? lastAttempt.level + (marked[lastAttempt.id].correct === 2 ? 1 : -1) : 3
  const attemptId = `attempt-${level}`
  marked[attemptId] = { level, correct: 0, total: 2 }
  lastAttempt = { id: attemptId, level }
  return Promise.resolve({ runId: 'run-1', attemptId, level, calibrate: serverCalibrates, questions: questionsFor(level).map(withoutAnswers) })
})
const checkAnswer = vi.fn(({ attemptId, questionId, answer }) => {
  const question = questionsFor(marked[attemptId].level).find((q) => q.id === questionId)
  const correct = question.items.find((i) => i.correct).id === answer
  if (correct) marked[attemptId].correct += 1
  return Promise.resolve({ correct, question })
})
const finishCheck = vi.fn(({ attemptId }) => {
  const { correct, total } = marked[attemptId]
  return Promise.resolve({ score: correct, total, passed: correct / total >= 0.7 })
})
const settleCheck = vi.fn(() => Promise.resolve({ level: settledLevel }))
vi.mock('../lib/skillDiagnostics', () => ({
  startKnowledgeCheck: (...a) => startCheck(...a),
  checkKnowledgeAnswer: (...a) => checkAnswer(...a),
  finishKnowledgeCheck: (...a) => finishCheck(...a),
  settleKnowledgeCheck: (...a) => settleCheck(...a),
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
  for (const mock of [startCheck, checkAnswer, finishCheck, settleCheck]) mock.mockClear()
  settledLevel = null
  serverCalibrates = false
  lastAttempt = null
})
afterEach(cleanup)

function renderQuiz(props = {}) {
  const onClose = vi.fn()
  const onConfirmed = vi.fn()
  render(
    <ConfirmingBaselineQuizModal
      skill={{ id: 's1', name: 'Weight loss', knowledge_level: 3, lifecycle_stage: 'identified', library_skill_id: 'lib1' }}
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
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
  await screen.findByText('Question 2 of 2')
  fireEvent.click(screen.getByLabelText(right ? 'True' : 'False', { exact: false }))
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Finish' }))
}

describe('the knowledge check', () => {
  it('opens on an intro, then shows the server’s marking after each answer', async () => {
    renderQuiz()
    expect(await screen.findByText('Quick check: Weight loss')).toBeTruthy()
    await start()
    expect(screen.getByText('Question one at 3')).toBeTruthy()

    // The explanation isn't sent until the answer is marked.
    expect(screen.queryByText('Because it is.')).toBeNull()
    fireEvent.click(screen.getByLabelText('Wrong', { exact: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Not quite.')).toBeTruthy()
    expect(screen.getByText('Because it is.')).toBeTruthy()
    expect(checkAnswer).toHaveBeenCalledWith({ attemptId: 'attempt-3', questionId: 'L3-q1', answer: 'w' })
  })

  it('confirms the pitched level on a pass, recorded by the server', async () => {
    settledLevel = 3
    renderQuiz()
    await start()
    await answerRound(true)

    await screen.findByText('Saved as your knowledge level for this skill.')
    expect(screen.getByText('Confirmed!')).toBeTruthy()
    expect(finishCheck).toHaveBeenCalledWith({ attemptId: 'attempt-3' })
    expect(settleCheck).toHaveBeenCalledWith({ runId: 'run-1' })
  })

  it('steps down a level, without celebrating, on a fail', async () => {
    settledLevel = 2
    renderQuiz()
    await start()
    await answerRound(false)
    await screen.findByText('Saved as your knowledge level for this skill.')
    expect(screen.getByText("Here's where you landed")).toBeTruthy()
    expect(settleCheck).toHaveBeenCalledWith({ runId: 'run-1' })
  })
})

describe('a knowledge check with no self-assessment to start from', () => {
  it('finds the level and saves it as the skill’s knowledge level without needing Continue', async () => {
    settledLevel = 3
    serverCalibrates = true
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
    expect(startCheck.mock.calls.map(([args]) => args.runId)).toEqual([null, 'run-1'])
    expect(screen.getAllByText('Familiar').length).toBeGreaterThan(0)
    expect(settleCheck).toHaveBeenCalledWith({ runId: 'run-1' })

    // Closing it any way now reloads the page to show the level.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })
})
