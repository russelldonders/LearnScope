import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../context/LanguageContext', () => import('../test/languageMock'))
vi.mock('./EvidenceFields', () => ({ default: () => null }))

const { default: SkillGoalEntryForm } = await import('./SkillGoalEntryForm')

const inSets = {
  id: 'g1', title: 'Push-ups', measure_kind: 'count', unit: 'push-ups', metric: 'count',
  aggregation: 'total', period: 'week', target_value: 300, sets_per_session: 3,
  started_on: '2026-01-01',
}

afterEach(cleanup)

function renderForm(goal, onSubmit = vi.fn().mockResolvedValue()) {
  render(<SkillGoalEntryForm goal={goal} statements={[]} idPrefix="t" submitLabel="Save" onSubmit={onSubmit} />)
  return onSubmit
}

describe('SkillGoalEntryForm', () => {
  it('starts a goal done in sets on Set 1, adds more with + Add a set, and hands back each further set', async () => {
    const onSubmit = renderForm(inSets)
    fireEvent.change(screen.getByLabelText('Set 1'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add a set' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add a set' }))
    fireEvent.change(screen.getByLabelText('Set 2'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Set 3'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove set 3' }))
    expect(screen.queryByLabelText('Set 3')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const values = onSubmit.mock.calls[0][0]
    expect(values.input.value).toBe('20')
    expect(values.extraSets.map((set) => set.value)).toEqual(['15'])
    // Cleared for the next time.
    await waitFor(() => expect(screen.queryByLabelText('Set 2')).not.toBeInTheDocument())
  })

  it('won’t save with an empty extra set', async () => {
    const onSubmit = renderForm(inSets)
    fireEvent.change(screen.getByLabelText('Set 1'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add a set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps a single unit-labelled value for a goal not done in sets', () => {
    renderForm({ ...inSets, aggregation: 'best', sets_per_session: null })
    expect(screen.getByLabelText('push-ups')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add a set' })).not.toBeInTheDocument()
  })
})
