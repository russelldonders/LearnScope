import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('./SkillGoalEntryForm', () => ({ default: () => <form aria-label="Entry form" /> }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillGoalEntriesModal } = await import('./SkillGoalEntriesModal')
const { localDateString } = await import('../lib/skillGoalProgress')
const { MEASUREMENT_EXTENSION_IRI } = await import('../lib/xapiStatement')

afterEach(cleanup)

const today = new Date()
today.setHours(12, 0, 0, 0)
const at = (days, hours) => new Date(today.getTime() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000)
const situps = (id, value, when) => ({
  id,
  recorded_at: when.toISOString(),
  resource_id: null,
  statement: { result: { extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric: 'sit_ups', kind: 'count', unit: 'sit-ups', value }] } } },
})
const baseGoal = {
  id: 'g1', title: '3 sets of 100 sit-ups', status: 'active', metric: 'sit_ups', measure_kind: 'count', unit: 'sit-ups',
  direction: 'higher', aggregation: 'total', period: 'week', target_value: 1200, started_on: localDateString(at(30, 0)),
}

function renderModal(goal, statements) {
  return render(<SkillGoalEntriesModal goal={goal} statements={statements} onChanged={vi.fn()} onClose={vi.fn()} />)
}

describe('SkillGoalEntriesModal', () => {
  it('groups a goal done in sets by day, numbering each day\'s sets and dashing those left', () => {
    const goal = { ...baseGoal, per_set: 100, sets_per_session: 3, sessions_per_period: 4 }
    const { container } = renderModal(goal, [
      situps('a', 100, at(1, 3)), situps('b', 100, at(1, 2)), situps('c', 100, at(1, 1)),
      situps('d', 100, at(0, 2)), situps('e', 100, at(0, 1)),
    ])
    const days = container.querySelectorAll('ul.space-y-3 > li')
    expect(days).toHaveLength(2)
    // Newest day first, with the same words as the dashboard.
    expect(within(days[0]).getByText('200 of 300 sit-ups · 2 of 3 sets')).toBeInTheDocument()
    expect(days[0].querySelectorAll('[data-set]')).toHaveLength(2)
    expect(days[0].querySelectorAll('[data-remaining]')).toHaveLength(1)
    expect(within(days[0]).getByText(/Set 1/)).toBeInTheDocument()
    expect(within(days[0]).getByText(/Set 2/)).toBeInTheDocument()
    expect(within(days[1]).getByText('300 of 300 sit-ups · 3 of 3 sets')).toHaveClass('text-moss')
    expect(days[1].querySelectorAll('[data-remaining]')).toHaveLength(0)
    // Each set can still be corrected or deleted on its own.
    expect(screen.getAllByRole('button', { name: 'Correct' })).toHaveLength(5)
  })

  it('calls a set past the day\'s target an extra one', () => {
    const goal = { ...baseGoal, per_set: 20, sets_per_session: 2, sessions_per_period: 4 }
    renderModal(goal, [situps('a', 20, at(0, 3)), situps('b', 20, at(0, 2)), situps('c', 20, at(0, 1))])
    expect(screen.getByText(/Extra set/)).toBeInTheDocument()
  })

  it('lists any other goal one entry at a time with its date', () => {
    const { container } = renderModal(baseGoal, [situps('a', 100, at(1, 0)), situps('b', 50, at(0, 0))])
    expect(container.querySelectorAll('ul.space-y-2 > li')).toHaveLength(2)
    expect(screen.queryByText(/Set 1/)).not.toBeInTheDocument()
  })
})
