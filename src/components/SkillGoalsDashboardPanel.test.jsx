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

describe('adding a goal', () => {
  it('offers "Add goal" at the top of the section, even before there are goals', () => {
    const onAddGoal = vi.fn()
    renderPanel([], { onAddGoal })
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }))
    expect(onAddGoal).toHaveBeenCalledTimes(1)
  })

  it('shows only the goals asked for until "Show all" is used', () => {
    const goals = ['A', 'B', 'C', 'D', 'E'].map((title) => item({ title, target_value: 40 }))
    renderPanel(goals, { collapsedCount: 3 })
    expect(screen.getAllByRole('article')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5 goals' }))
    expect(screen.getAllByRole('article')).toHaveLength(5)
  })
})

describe('goal tiles', () => {
  it('give every kind of goal the same parts in the same order, at the same heights', () => {
    const { container } = renderPanel([
      item({ title: 'Best', target_value: 40 }, [pushUps('a', 20, daysAgo(3))]),
      item({ title: 'Weekly total', aggregation: 'total', period: 'week', target_value: 100, target_date: '2027-06-30' }, [pushUps('b', 30, daysAgo(0))]),
      item({ title: 'No target' }),
      item({
        title: 'In sets', aggregation: 'total', period: 'week', target_value: 1200,
        per_set: 100, sets_per_session: 3, sessions_per_period: 4,
      }, [pushUps('c', 100, daysAgo(0))]),
    ])
    const tiles = container.querySelectorAll('article')
    expect(tiles).toHaveLength(4)
    for (const tile of tiles) {
      const parts = [...tile.children].map((child) => child.tagName)
      expect(parts).toEqual(['DIV', 'DL', 'DIV', 'DIV', 'P', 'DIV'])
      // The lines under the value and the chart keep a fixed height, so tiles
      // side by side are the same size whatever they show.
      expect(tile.children[2]).toHaveClass('h-8')
      expect(tile.children[3]).toHaveClass('h-16')
    }
    // Repeating goals get bars; the one heading for a single target, a line.
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(within(tiles[0]).getByRole('img').querySelector('svg')).not.toBeNull()
  })

  it('shows the current value large, with the target and date beside it', () => {
    renderPanel([item({ title: 'Best', target_value: 40, target_date: '2027-06-30' }, [pushUps('a', 10, daysAgo(5)), pushUps('b', 25, daysAgo(3))])])
    const tile = screen.getByRole('article', { name: 'Best' })
    expect(within(tile).getByText('25 push-ups')).toHaveClass('text-2xl')
    expect(within(tile).getByText(/^Target 40 push-ups · By .*2027$/)).toBeInTheDocument()
    expect(within(tile).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows a goal done in sets as sessions this week, with today and the shape as its target', () => {
    const goal = {
      title: 'Sit-ups', aggregation: 'total', period: 'week', target_value: 1200,
      per_set: 100, sets_per_session: 3, sessions_per_period: 4, started_on: localDateString(daysAgo(30)),
    }
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    const earlier = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000)
    renderPanel([item(goal, [pushUps('a', 100, earlier(2)), pushUps('b', 50, earlier(1))])])
    const tile = screen.getByRole('article', { name: 'Sit-ups' })
    expect(within(tile).getByText('0 of 4 sessions')).toHaveClass('text-2xl')
    expect(within(tile).getByText('Target 3 × 100 push-ups · 4 days a week')).toBeInTheDocument()
    expect(within(tile).getByText('Today 150 of 300 push-ups · 2 of 3 sets')).toBeInTheDocument()
    const chart = within(tile).getByRole('img')
    expect(chart.lastChild.lastChild).toHaveTextContent('Today')
  })

  it('opens the skill from the title, as one link with the skill named', () => {
    renderPanel([item({ title: 'Best', target_value: 40 })])
    const tile = screen.getByRole('article', { name: 'Best' })
    const links = within(tile).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('Best Fitness')
    expect(links[0]).toHaveAttribute('href', '/skills/skill-1')
  })

  it('says when a goal has no target, with a link to add one', () => {
    renderPanel([item({ title: 'Daily', aggregation: 'total', period: 'day' }, [pushUps('a', 20, daysAgo(0))])])
    const tile = screen.getByRole('article', { name: 'Daily' })
    expect(within(tile).getByText(/^No target/)).toBeInTheDocument()
    expect(within(tile).getByRole('link', { name: 'Add one' })).toHaveAttribute('href', '/skills/skill-1')
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

  it('shows a repeating goal its last seven days, missed in red, the part over the target lighter, with the streak', () => {
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
    expect(bars[5].style.background).toBe('')
    // 21 against 20: green up to the target, the last 1 lighter.
    expect(bars[6]).toHaveClass('bg-moss')
    expect(bars[6].style.background).toMatch(/linear-gradient/)
    expect(bars[6].style.background).toMatch(/95\.2\d*%/)
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

  it('shows any other goal its recent entries as a line with a dot on each, latest on the right', () => {
    renderPanel([item({ title: 'Best', target_value: 40 }, [pushUps('a', 10, daysAgo(5)), pushUps('b', 25, daysAgo(3))])])
    const tile = screen.getByRole('article', { name: 'Best' })
    const chart = within(tile).getByRole('img')
    const dots = chart.querySelectorAll('[data-dot]')
    expect(dots).toHaveLength(2)
    expect(parseFloat(dots[1].style.left)).toBeGreaterThan(parseFloat(dots[0].style.left))
    expect(chart.querySelector('polyline').getAttribute('points').split(' ')).toHaveLength(2)
    expect(chart.getAttribute('aria-label')).toMatch(/25 push-ups/)
    // The trend says how it's going, so there's no progress bar as well.
    expect(within(tile).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('labels the target line with the target and its date', () => {
    const goal = { title: 'Weight', direction: 'lower', target_value: 96, target_date: '2027-02-02' }
    renderPanel([
      item(goal, [pushUps('a', 102, daysAgo(5)), pushUps('b', 101, daysAgo(3))]),
      item({ ...goal, title: 'Undated', target_date: null }, [pushUps('c', 102, daysAgo(5))]),
    ])
    const chart = within(screen.getByRole('article', { name: 'Weight' })).getByRole('img')
    expect(chart.querySelector('[data-target-label]')).toHaveTextContent('96 push-ups by 02/02/27')
    expect(chart.getAttribute('aria-label')).toContain('Target 96 push-ups by 02/02/27')
    const undated = within(screen.getByRole('article', { name: 'Undated' })).getByRole('img')
    expect(undated.querySelector('[data-target-label]')).toHaveTextContent(/^96 push-ups$/)
  })

  it('scales single readings around the target, so a weight to lose sits above its line', () => {
    const goal = { title: 'Weight', direction: 'lower', target_value: 96 }
    renderPanel([item(goal, [pushUps('a', 102, daysAgo(5)), pushUps('b', 101, daysAgo(3))])])
    const chart = within(screen.getByRole('article', { name: 'Weight' })).getByRole('img')
    const line = chart.querySelector('.border-dashed')
    const dots = chart.querySelectorAll('[data-dot]')
    const lineAt = parseFloat(line.style.bottom)
    expect(lineAt).toBeGreaterThan(10)
    expect(lineAt).toBeLessThan(40)
    expect(parseFloat(dots[1].style.bottom)).toBeGreaterThan(80)
    expect(parseFloat(dots[1].style.bottom)).toBeLessThan(parseFloat(dots[0].style.bottom))
  })

  it('shows a total building up to one target as progress with what is left', () => {
    const goal = { title: 'Mandarins', aggregation: 'total', period: 'year', target_value: 10, target_date: `${new Date().getFullYear()}-12-31` }
    renderPanel([item(goal, [pushUps('a', 2, daysAgo(0))])])
    const tile = screen.getByRole('article', { name: 'Mandarins' })
    expect(within(tile).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
    expect(within(tile).getByText('20%')).toBeInTheDocument()
    // This year's deadline, so no year in the date.
    expect(within(tile).getByText(/^8 push-ups to go by (31 Dec|Dec 31)$/)).toBeInTheDocument()
    // Filling a bucket: the bar says it all, no trend line.
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
