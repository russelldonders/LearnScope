import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchPlan = vi.fn(() =>
  Promise.resolve({ sessionId: 'sess1', openingQuestion: 'What does a variable do?', topics: ['Variables', 'Scope'] })
)
const sendTurn = vi.fn()
const saveInterview = vi.fn(() => Promise.resolve({ level: 3 }))
vi.mock('../lib/skillDiagnostics', () => ({
  startInterview: (...args) => fetchPlan(...args),
  sendInterviewAnswer: (...args) => sendTurn(...args),
  saveInterview: (...args) => saveInterview(...args),
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

const { default: InterviewModal } = await import('./InterviewModal')

const skill = { id: 's1', name: 'JavaScript', knowledge_level: 3, lifecycle_stage: 'confirming_baseline' }

function renderModal(props = {}) {
  const onClose = vi.fn()
  const onConfirmed = vi.fn()
  render(
    <InterviewModal
      skill={skill}
      user={{ id: 'u1', email: 'a@b.c' }}
      actor={{ name: 'A', email: 'a@b.c' }}
      latestKnowledgeAssessment={{ level: 3 }}
      onClose={onClose}
      onConfirmed={onConfirmed}
      {...props}
    />
  )
  return { onClose, onConfirmed }
}

async function startInterview() {
  fireEvent.click(await screen.findByRole('button', { name: "I'm ready — let's go" }))
}

function answer(text) {
  const box = screen.getByLabelText('Type your answer…')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

beforeEach(() => {
  sendTurn.mockReset()
  saveInterview.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('InterviewModal', () => {
  it('opens on an intro that says what to expect before any question is asked', async () => {
    renderModal()
    expect(await screen.findByText("Let's talk JavaScript")).toBeTruthy()
    expect(screen.getByText('Up to 6 questions')).toBeTruthy()
    expect(screen.getByText('Variables')).toBeTruthy()
    expect(screen.queryByText('What does a variable do?')).toBeNull()

    await startInterview()
    expect(screen.getByText('What does a variable do?')).toBeTruthy()
    expect(screen.getByText('Question 1 of up to 6')).toBeTruthy()
  })

  it('sends on Enter, advances the progress, and reveals then saves the result', async () => {
    sendTurn
      .mockResolvedValueOnce({ message: 'Nice. What about scope?', done: false })
      .mockResolvedValueOnce({ message: 'Thanks, that is all.', done: true, confirmedLevel: 3, reasoning: 'Solid grasp.' })
    const { onConfirmed } = renderModal()
    await startInterview()

    answer('It stores a value')
    expect(await screen.findByText('Nice. What about scope?')).toBeTruthy()
    expect(screen.getByText('Question 2 of up to 6')).toBeTruthy()
    // Only the new answer goes to the server, which keeps the conversation.
    expect(sendTurn.mock.calls[0][0]).toEqual({ sessionId: 'sess1', answer: 'It stores a value' })

    answer('Block and function scope')
    fireEvent.click(await screen.findByRole('button', { name: 'See where you landed →' }))
    expect(screen.getByText('Nicely done!')).toBeTruthy()
    expect(screen.getByText('Solid grasp.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save to my skill' }))
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(saveInterview).toHaveBeenCalledWith({ sessionId: 'sess1' })
  })

  it('stays honest rather than celebratory when the learner lands below the pitched level', async () => {
    sendTurn.mockResolvedValueOnce({ message: 'Thanks!', done: true, confirmedLevel: 2, reasoning: 'Some gaps.' })
    renderModal()
    await startInterview()
    answer('Not sure')
    fireEvent.click(await screen.findByRole('button', { name: 'See where you landed →' }))
    expect(screen.getByText("Here's where you landed")).toBeTruthy()
    expect(screen.queryByText('Nicely done!')).toBeNull()
  })

  it('keeps the answer and lets the learner retry when a turn fails', async () => {
    sendTurn.mockRejectedValueOnce(new Error('Network down'))
    renderModal()
    await startInterview()
    answer('My answer')
    expect(await screen.findByText('Network down')).toBeTruthy()
    expect(screen.getByLabelText('Type your answer…').value).toBe('My answer')
  })

  it('checks before discarding answers on close, but closes straight away before any answer', async () => {
    sendTurn.mockResolvedValueOnce({ message: 'Next?', done: false })
    const { onClose } = renderModal()
    await startInterview()

    answer('Something')
    await screen.findByText('Next?')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Leave the interview?')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }))
    expect(screen.queryByText('Leave the interview?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave anyway' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without a check when nothing has been answered yet', async () => {
    const { onClose } = renderModal()
    fireEvent.click(await screen.findByRole('button', { name: 'Maybe later' }))
    expect(onClose).toHaveBeenCalled()
  })
})
