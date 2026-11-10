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

  it('shows the current value large, with the target and date beside it', () => {
    renderPanel([item({ title: 'Best', target_value: 40, target_date: '2027-06-30' }, [pushUps('a', 10, daysAgo(5)), pushUps('b', 25, daysAgo(3))])])
    const tile = screen.getByRole('article', { name: 'Best' })
    expect(within(tile).getByText('25 push-ups')).toHaveClass('text-2xl')
    expect(within(tile).getByText(/^Target 40 push-ups · By .*2027$/)).toBeInTheDocument()
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

  it('shows a repeating goal its last seven days, missed in red, beaten in a brighter green, with the streak', () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const day = (n) => new Date(today.getTime() - n * 24 * 60 * 60 * 1000)
    const goal = { title: 'Daily', aggregation: 'total', period: 'day', target_value: 20, started_on: localDateString(day(30)) }
    const statements = [pushUps('a', 25, day(3)), pushUps('b', 5, day(2)), pushUps('c', 20, day(1)), pushUps('d', 21, day(0))]
    renderPanel([item(goal, statements)])
    const tile = screen.getByRole('article', { name: 'Daily' })
    const chart = within(tile).getByRole('img', { name: /^Recent history: / })
    const bars = chart.firstChild.querySelectorAll(':scope > span')
    expect(bars).toHaveLength(7)
    // A day with nothing logged is still a visible red bar, not a sliver.
    expect(bars[0]).toHaveClass('bg-red-700/70')
    expect(bars[0].style.height).toBe('15%')
    expect(bars[4]).toHaveClass('bg-red-700/70')
    expect(bars[5]).toHaveClass('bg-moss')
    expect(bars[6]).toHaveClass('bg-emerald-500')
    expect(chart.getAttribute('aria-label')).toMatch(/5 push-ups \(missed\)/)
    expect(chart.getAttribute('aria-label')).toMatch(/21 push-ups \(beat the target\)/)
    expect(chart.lastChild.lastChild).toHaveTextContent('Today')
    expect(within(tile).getByText('Met 2 days in a row')).toBeInTheDocument()
    // The bars stand in for the progress bar on a repeating goal.
    expect(within(tile).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('stacks a day logged several times from its entries, and says so on hover', () => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const earlier = (hours) => new Date(today.getTime() - hours * 60 * 60 * 1000)
    const goal = { title: 'Sets', aggregation: 'total', period: 'day', target_value: 60, started_on: localDateString(daysAgo(10)) }
    renderPanel([item(goal, [pushUps('a', 20, earlier(3)), pushUps('b', 20, earlier(2)), pushUps('c', 20, earlier(1))])])
    const chart = within(screen.getByRole('article', { name: 'Sets' })).getByRole('img')
    expect(chart.getAttribute('aria-label')).toMatch(/60 push-ups from 3 entries \(20 \+ 20 \+ 20\) \(met\)/)
    const todayBar = chart.firstChild.querySelectorAll(':scope > span')[6]
    expect(todayBar.querySelectorAll('[data-part]')).toHaveLength(3)
    fireEvent.mouseEnter(todayBar)
    expect(within(chart).getByText(/^Today 60 push-ups from 3 entries/)).toBeInTheDocument()
    fireEvent.mouseLeave(chart.firstChild)
    expect(within(chart).queryByText(/from 3 entries/)).not.toBeInTheDocument()
  })

  it('shows any other goal its recent entries, the latest highlighted', () => {
    renderPanel([item({ title: 'Best', target_value: 40 }, [pushUps('a', 10, daysAgo(5)), pushUps('b', 25, daysAgo(3))])])
    const tile = screen.getByRole('article', { name: 'Best' })
    const bars = within(tile).getByRole('img').firstChild.querySelectorAll(':scope > span')
    expect(bars).toHaveLength(7)
    expect(bars[5]).toHaveClass('bg-hairline/60')
    expect(bars[6]).toHaveClass('bg-moss')
    expect(within(tile).getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows a total building up to one target as progress with what is left', () => {
    const goal = { title: 'Mandarins', aggregation: 'total', period: 'year', target_value: 10, target_date: `${new Date().getFullYear()}-12-31` }
    renderPanel([item(goal, [pushUps('a', 2, daysAgo(0))])])
    const tile = screen.getByRole('article', { name: 'Mandarins' })
    expect(within(tile).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
    expect(within(tile).getByText('20%')).toBeInTheDocument()
    // This year's deadline, so no year in the date.
    expect(within(tile).getByText(/^8 push-ups to go by (31 Dec|Dec 31)$/)).toBeInTheDocument()
    expect(within(tile).queryByRole('img')).not.toBeInTheDocument()
  })

  it('says how much is left without a date when the goal has none', () => {
    renderPanel([item({ title: 'Lifetime', aggregation: 'total', target_value: 1000 }, [pushUps('a', 250, daysAgo(1))])])
    expect(within(screen.getByRole('article', { name: 'Lifetime' })).getByText('750 push-ups to go')).toBeInTheDocument()
  })

  it('can carry its own heading, for the goals due today', () => {
    renderPanel([item({ title: 'Best', target_value: 40 })], {
      headingId: 'due-heading',
      title: 'Due today',
      subtitle: 'These goals are waiting for a log.',
    })
    const section = screen.getByRole('region', { name: 'Due today' })
    expect(within(section).getByText('These goals are waiting for a log.')).toBeInTheDocument()
    expect(within(section).getByRole('article', { name: 'Best' })).toBeInTheDocument()
  })

  it('opens logging from either button', () => {
    const onOpenGoal = vi.fn()
    renderPanel([item({ title: 'Best', target_value: 40 }, [pushUps('a', 20, daysAgo(3))])], { onOpenGoal })
    fireEvent.click(screen.getByRole('button', { name: 'Same as last time' }))
    expect(onOpenGoal).toHaveBeenCalledWith('Best')
  })
})
