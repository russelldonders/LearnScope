import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => {
  const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve({ data: { full_name: 'Test' } }) }
  return { supabase: { from: () => chain } }
})
vi.mock('./SkillGoalEntryForm', () => ({ default: () => <form aria-label="Entry form" /> }))
vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: SkillGoalsDashboardPanel } = await import('./SkillGoalsDashboardPanel')
const { computeGoalProgress, localDateString } = await import('../lib/skillGoalProgress')
const { MEASUREMENT_EXTENSION_IRI } = await import('../lib/xapiStatement')

afterEach(cleanup)

const skill = { id: 'skill-1', name: 'Fitness' }
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)
const pushUps = (id, value, when) => ({
  id,
  recorded_at: when.toISOString(),
  statement: { result: { extensions: { [MEASUREMENT_EXTENSION_IRI]: [{ metric: 'push_ups', kind: 'count', unit: 'push-ups', value }] } } },
})

function item(goal, statements = [], nextLog = null) {
  const full = {
    id: goal.title, metric: 'push_ups', measure_kind: 'count', unit: 'push-ups', direction: 'higher', aggregation: 'best',
    period: null, target_value: null, target_date: null, started_on: localDateString(daysAgo(60)), tracker_question: 'How many?', ...goal,
  }
  return { goal: full, skill, statements, progress: computeGoalProgress(full, statements), nextLog }
}

function renderPanel(items, props = {}) {
  return render(
    <MemoryRouter>
      <SkillGoalsDashboardPanel items={items} user={{ id: 'me', email: 'me@example.com' }} openGoalId={null} onOpenGoal={vi.fn()} onChanged={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

describe('goal tiles', () => {
  it('give every kind of goal the same parts in the same order', () => {
    const { container } = renderPanel([
      item({ title: 'Best', target_value: 40 }, [pushUps('a', 20, daysAgo(3))]),
      item({ title: 'Weekly total', aggregation: 'total', period: 'week', target_value: 100, target_date: '2027-06-30' }, [pushUps('b', 30, daysAgo(0))]),
      item({ title: 'No target' }),
    ])
    const tiles = container.querySelectorAll('article')
    expect(tiles).toHaveLength(3)
    for (const tile of tiles) {
      const parts = [...tile.children].map((child) => child.tagName)
      expect(parts).toEqual(['DIV', 'DL', 'DIV', 'P', 'DIV'])
    }
    // No per-period chart on the dashboard any more.
    expect(container.querySelector('svg')).toBeNull()
  })

  it('shows the current value large with the target beside it', () => {
    renderPanel([item({ title: 'Best', target_value: 40, target_date: '2027-06-30' }, [pushUps('a', 10, daysAgo(5)), pushUps('b', 25, daysAgo(3))])])
    const tile = screen.getByRole('article', { name: 'Best' })
    expect(within(tile).getByText('25 push-ups')).toHaveClass('text-2xl')
    expect(within(tile).getByText(/^Target 40 push-ups · By /)).toBeInTheDocument()
    expect(within(tile).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })

  it('uses one status line: reached first, then last logged, then nothing yet', () => {
    renderPanel([
      item({ title: 'Reached', target_value: 10 }, [pushUps('a', 12, daysAgo(1))]),
      item({ title: 'Going', target_value: 40 }, [pushUps('b', 20, daysAgo(1))]),
      item({ title: 'Fresh', target_value: 40 }),
    ])
    expect(within(screen.getByRole('article', { name: 'Reached' })).getByText('Target reached')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Going' })).getByText(/^Last logged/)).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Fresh' })).getByText('Nothing logged yet')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Fresh' })).getByText('–')).toBeInTheDocument()
  })

  it('opens logging from either button', () => {
    const onOpenGoal = vi.fn()
    renderPanel([item({ title: 'Best', target_value: 40 }, [pushUps('a', 20, daysAgo(3))])], { onOpenGoal })
    fireEvent.click(screen.getByRole('button', { name: 'Same as last time' }))
    expect(onOpenGoal).toHaveBeenCalledWith('Best')
  })
})
