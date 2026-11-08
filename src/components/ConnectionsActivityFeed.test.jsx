import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { default: ConnectionsActivityFeed } = await import('./ConnectionsActivityFeed')
const { sectionedActivity } = await import('../lib/connectionsActivity')

afterEach(cleanup)

const NOW = new Date('2026-11-08T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const alex = { actor_id: 'person-1', full_name: 'Alex Morgan', avatar_url: null }
const sam = { actor_id: 'person-2', full_name: 'Sam Lee', avatar_url: null }
const event = (person, overrides) => ({ ...person, event_type: 'skill_added', level: null, detail: null, skill_name: 'Sketching', event_at: daysAgo(1), ...overrides })

function renderFeed(events, props = {}) {
  return render(<MemoryRouter><ConnectionsActivityFeed events={events} now={NOW} {...props} /></MemoryRouter>)
}

describe('connections activity feed', () => {
  it('groups the same milestone across skills, newest skill first, and says it in full for screen readers', () => {
    renderFeed([
      event(alex, { skill_name: 'Interior Design', event_at: daysAgo(1) }),
      event(alex, { skill_name: 'Colour Theory', event_at: daysAgo(1.1) }),
      event(alex, { skill_name: 'Sketching', event_at: daysAgo(1.2) }),
      event(alex, { skill_name: 'Lighting Design', event_at: daysAgo(1.3) }),
    ])
    expect(screen.getByText('Alex Morgan started tracking Interior Design and 3 other skills')).toBeInTheDocument()
    expect(screen.getByText('Interior Design, Colour Theory, Sketching')).toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('puts events under time headings with one block per person', () => {
    renderFeed([
      event(alex, { event_at: daysAgo(1) }),
      event(sam, { event_type: 'course_started', skill_name: null, detail: 'Design Basics · OpenLearn', event_at: daysAgo(2) }),
      event(alex, { event_type: 'target_set', level: 3, skill_name: 'Lighting', event_at: daysAgo(3) }),
      event(alex, { event_type: 'experience_added', skill_name: null, detail: 'employment at Continental: Designer', event_at: daysAgo(40) }),
    ])
    const thisWeek = screen.getByRole('region', { name: 'This week' })
    expect(within(thisWeek).getAllByRole('link').map((link) => link.textContent)).toEqual(['AAlex Morgan', 'SSam Lee'])
    expect(within(thisWeek).getByText('Aiming for Capable')).toBeInTheDocument()
    expect(within(thisWeek).getByText('Design Basics')).toBeInTheDocument()
    expect(within(thisWeek).getByText('Started a course · OpenLearn')).toBeInTheDocument()
    const earlier = screen.getByRole('region', { name: 'Earlier' })
    expect(within(earlier).getByText('Designer')).toBeInTheDocument()
    expect(within(earlier).getByText('Added to their experience · Continental')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'This month' })).not.toBeInTheDocument()
  })

  it('leads with the skill and level, and labels how it was backed up', () => {
    renderFeed([
      event(alex, { event_type: 'skill_validated', level: 3, skill_name: 'SQL', detail: 'Validated by a connection' }),
      event(sam, { event_type: 'skill_confirmed', level: 2, skill_name: 'Sales', detail: 'AI-assessed baseline' }),
    ])
    expect(screen.getByText('SQL')).toBeInTheDocument()
    expect(screen.getByText('Validated by a connection')).toBeInTheDocument()
    expect(screen.getByText('Level validated')).toBeInTheDocument()
    expect(screen.getByText('AI estimate')).toBeInTheDocument()
    expect(screen.getByText('Level confirmed')).toBeInTheDocument()
  })

  it('marks what arrived since the last visit, but nothing on a first visit', () => {
    const events = [event(alex, { event_at: daysAgo(1) }), event(sam, { skill_name: 'Piano', event_at: daysAgo(5) })]
    renderFeed(events, { lastSeenAt: new Date(NOW - 3 * 24 * 60 * 60 * 1000) })
    expect(screen.getAllByText('New')).toHaveLength(1)
    expect(screen.getByText('· 1 new')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alex Morgan (New)' })).toBeInTheDocument()
    cleanup()
    renderFeed(events)
    expect(screen.queryByText('New')).not.toBeInTheDocument()
  })

  it('filters by person from the strip, shown only with more than one person', () => {
    renderFeed([event(alex, { skill_name: 'Sketching' }), event(sam, { skill_name: 'Piano' })])
    const strip = screen.getByRole('group', { name: 'Show activity from' })
    fireEvent.click(within(strip).getByRole('button', { name: 'Sam Lee' }))
    expect(within(strip).getByRole('button', { name: 'Sam Lee' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Sketching')).not.toBeInTheDocument()
    expect(screen.getByText('Piano')).toBeInTheDocument()
    fireEvent.click(within(strip).getByRole('button', { name: 'Everyone' }))
    expect(screen.getByText('Sketching')).toBeInTheDocument()
    cleanup()
    renderFeed([event(alex, {})])
    expect(screen.queryByRole('group', { name: 'Show activity from' })).not.toBeInTheDocument()
  })

  it('shows the first eight events, then the rest on request', () => {
    renderFeed(Array.from({ length: 11 }, (_, i) => event(i % 2 ? alex : sam, { event_type: 'course_started', skill_name: null, detail: `Course ${i}`, event_at: daysAgo(i) })))
    expect(screen.queryByText('Course 8')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }))
    expect(screen.getByText('Course 10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })
})

describe('sectionedActivity', () => {
  it('keeps one block per person within a section, ordered by their newest event', () => {
    const sections = sectionedActivity([
      event(alex, { event_at: daysAgo(1) }),
      event(sam, { event_at: daysAgo(2) }),
      event(alex, { event_at: daysAgo(3) }),
    ], NOW)
    expect(sections).toHaveLength(1)
    expect(sections[0].people.map((p) => [p.actorId, p.events.length])).toEqual([['person-1', 2], ['person-2', 1]])
  })
})
