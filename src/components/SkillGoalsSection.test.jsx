import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const goals = [
  { id: 'g1', title: 'Total push-ups per day', status: 'active', metric: 'push_ups', measure_kind: 'count', unit: 'push-ups', direction: 'higher', aggregation: 'total', period: 'day', target_value: null, target_date: null, started_on: '2026-11-07', tracker_question: 'How many?' },
  { id: 'g0', title: 'Old goal', status: 'replaced', closed_on: '2026-11-01', metric: 'push_ups', measure_kind: 'count', unit: 'push-ups', aggregation: 'total', period: 'day', target_value: 10, started_on: '2026-10-01' },
]

vi.mock('../lib/skillGoals', () => ({ listSkillGoals: vi.fn(() => Promise.resolve(goals)), logGoalEntry: vi.fn() }))
vi.mock('./SkillGoalChart', () => ({ default: () => null }))
vi.mock('./SkillGoalEntryForm', () => ({ default: () => null }))
vi.mock('./SkillGoalEntriesModal', () => ({ default: () => null }))
vi.mock('./SkillGoalModal', () => ({ default: ({ goal }) => <div role="dialog" aria-label={`Editing ${goal?.title ?? 'new goal'}`} /> }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return typeof value === 'string' && params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillGoalsSection } = await import('./SkillGoalsSection')

afterEach(cleanup)

function renderSection(props = {}) {
  return render(
    <SkillGoalsSection
      skill={{ id: 'skill-1', name: 'Push ups' }}
      user={{ id: 'me' }}
      actor={{ name: 'Me', email: 'me@example.com' }}
      statements={[]}
      onActivitiesChanged={vi.fn()}
      onSetLevelTarget={vi.fn()}
      {...props}
    />,
  )
}

describe('opening a goal for editing from elsewhere', () => {
  it('opens the requested goal once the goals have loaded, then lets the page forget the request', async () => {
    const onEditGoalOpened = vi.fn()
    renderSection({ editGoalId: 'g1', onEditGoalOpened })
    expect(await screen.findByRole('dialog', { name: 'Editing Total push-ups per day' })).toBeInTheDocument()
    expect(onEditGoalOpened).toHaveBeenCalledTimes(1)
  })

  it('opens nothing for a goal that is no longer active', async () => {
    const onEditGoalOpened = vi.fn()
    renderSection({ editGoalId: 'g0', onEditGoalOpened })
    await screen.findByText('Total push-ups per day')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onEditGoalOpened).toHaveBeenCalledTimes(1)
  })

  it('opens nothing without a request', async () => {
    renderSection()
    await screen.findByText('Total push-ups per day')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
