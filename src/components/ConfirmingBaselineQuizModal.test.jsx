import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Two questions per level; choice "a" is always right.
const quiz = {
  questions: [1, 2].map((n) => ({
    id: `q${n}`,
    description: { 'en-US': `Question ${n}` },
    correctResponsesPattern: ['a'],
    choices: [
      { id: 'a', description: { 'en-US': 'Right' } },
      { id: 'b', description: { 'en-US': 'Wrong' } },
    ],
  })),
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
vi.mock('../lib/skillDiagnostics', () => ({
  fetchOrGenerateDiagnosticQuiz: vi.fn(() => Promise.resolve({ diagnosticContentId: 'c1', content: quiz })),
  saveDiagnosticAttempt: vi.fn(() => Promise.resolve({ score: 0, total: 2 })),
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
})
afterEach(cleanup)

async function answerRound(choice) {
  // The previous round stays on screen while it saves, so wait for the new one.
  await screen.findByText('Question 1 of 2')
  fireEvent.click(screen.getByRole('button', { name: choice }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('Question 2 of 2')
  fireEvent.click(screen.getByRole('button', { name: choice }))
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
}

describe('a knowledge quiz with no self-assessment to start from', () => {
  it('finds the level and saves it as the skill’s knowledge level without needing Continue', async () => {
    const onClose = vi.fn()
    const onConfirmed = vi.fn()
    render(
      <ConfirmingBaselineQuizModal
        skill={{ id: 's1', name: 'Weight loss', knowledge_level: null, lifecycle_stage: 'identified' }}
        user={{ id: 'me' }}
        actor={{ name: 'Me', email: 'me@example.com' }}
        latestKnowledgeAssessment={null}
        calibrating
        onClose={onClose}
        onConfirmed={onConfirmed}
      />,
    )

    // Passes level 3, then fails level 4: lands on 3.
    await answerRound('Right')
    await answerRound('Wrong')

    await screen.findByText('Saved as your knowledge level for this skill.')
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
