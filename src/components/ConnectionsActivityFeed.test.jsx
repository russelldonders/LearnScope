import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../context/LanguageContext', async () => {
  const { english } = await import('../lib/i18n/translations')
  const t = (key, params) => {
    const value = key.split('.').reduce((v, part) => v?.[part], english) ?? key
    return params ? value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? params[name] : m)) : value
  }
  return { useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t }) }
})

const { EventRow } = await import('./ConnectionsActivityFeed')
const { groupConnectionsActivity, summariseActivity } = await import('../lib/connectionsActivity')

afterEach(cleanup)

const NOW = new Date('2026-11-08T12:00:00Z').getTime()
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
const alex = { actor_id: 'person-1', full_name: 'Alex Morgan', avatar_url: null }
const event = (overrides) => ({ ...alex, event_type: 'skill_added', level: null, detail: null, skill_name: 'Sketching', event_at: daysAgo(1), ...overrides })

function renderRows(events, lastSeenAt = null) {
  return render(
    <ul>
      {groupConnectionsActivity(events).map((e, i) => (
        <EventRow key={i} event={e} name="Alex Morgan" isNew={lastSeenAt != null && new Date(e.event_at) > lastSeenAt} />
      ))}
    </ul>,
  )
}

describe('activity event rows', () => {
  it('groups the same milestone across skills, newest skill first, and says it in full for screen readers', () => {
    renderRows([
      event({ skill_name: 'Interior Design', event_at: daysAgo(1) }),
      event({ skill_name: 'Colour Theory', event_at: daysAgo(1.1) }),
      event({ skill_name: 'Sketching', event_at: daysAgo(1.2) }),
      event({ skill_name: 'Lighting Design', event_at: daysAgo(1.3) }),
    ])
    expect(screen.getByText('Alex Morgan started tracking Interior Design and 3 other skills')).toBeInTheDocument()
    expect(screen.getByText('Interior Design, Colour Theory, Sketching')).toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('shows each change in a course on its own: planned, started, completed, cancelled', () => {
    const course = (type, at) => event({ event_type: type, skill_name: null, detail: 'Design Basics · OpenLearn', event_at: daysAgo(at) })
    renderRows([course('course_cancelled', 1), course('course_completed', 2), course('course_started', 3), course('course_planned', 4)])
    expect(screen.getByText('Cancelled a course · OpenLearn')).toBeInTheDocument()
    expect(screen.getByText('Completed a course · OpenLearn')).toBeInTheDocument()
    expect(screen.getByText('Started a course · OpenLearn')).toBeInTheDocument()
    expect(screen.getByText('Planning a course · OpenLearn')).toBeInTheDocument()
  })

  it('leads with the skill and level, and labels how it was backed up', () => {
    renderRows([
      event({ event_type: 'skill_validated', level: 3, skill_name: 'SQL', detail: 'Validated by a connection' }),
      event({ event_type: 'skill_confirmed', level: 2, skill_name: 'Sales', detail: 'AI-assessed baseline' }),
      event({ event_type: 'experience_added', skill_name: null, detail: 'employment at Continental: Designer' }),
    ])
    expect(screen.getByText('SQL')).toBeInTheDocument()
    expect(screen.getByText('Validated by a connection')).toBeInTheDocument()
    expect(screen.getByText('Level validated')).toBeInTheDocument()
    expect(screen.getByText('AI estimate')).toBeInTheDocument()
    expect(screen.getByText('Level confirmed')).toBeInTheDocument()
    expect(screen.getByText('Designer')).toBeInTheDocument()
    expect(screen.getByText('Added to their experience · Continental')).toBeInTheDocument()
  })

  it('marks what arrived since the last visit', () => {
    renderRows([event({ event_at: daysAgo(1) }), event({ skill_name: 'Piano', event_at: daysAgo(5) })], new Date(NOW - 3 * 24 * 60 * 60 * 1000))
    expect(screen.getAllByText('New')).toHaveLength(1)
  })
})

describe('summariseActivity', () => {
  const keys = (events, max) => summariseActivity(events, max).parts.map((part) => part.key)

  it('leads with the most telling news: validated and confirmed levels, then courses and roles', () => {
    const events = [
      event({ event_type: 'skill_added', skill_name: 'Piano' }),
      event({ event_type: 'course_completed', skill_name: null, detail: 'Design Basics · OpenLearn' }),
      event({ event_type: 'skill_confirmed', level: 4, skill_name: 'Python' }),
      event({ event_type: 'experience_added', skill_name: null, detail: 'employment at Continental: Designer' }),
    ]
    expect(summariseActivity(events)).toEqual({
      parts: [
        { key: 'reachedOne', params: { skill: 'Python', level: 4 } },
        { key: 'completedOne', params: { name: 'Design Basics' } },
        { key: 'roleAt', params: { title: 'Designer', organisation: 'Continental' } },
      ],
      more: 1,
    })
  })

  it('counts several of a kind, each skill or course once', () => {
    const events = [
      event({ skill_name: 'Piano' }),
      event({ skill_name: 'Piano', event_at: daysAgo(2) }),
      event({ skill_name: 'Guitar' }),
      event({ event_type: 'course_started', skill_name: null, detail: 'A · X' }),
      event({ event_type: 'course_started', skill_name: null, detail: 'B · X' }),
    ]
    expect(summariseActivity(events).parts).toEqual([
      { key: 'startedMany', params: { count: 2 } },
      { key: 'addedMany', params: { count: 2 } },
    ])
  })

  it('leaves a cancelled course out of the summary, and says nothing for no news', () => {
    expect(keys([event({ event_type: 'course_cancelled', skill_name: null, detail: 'A · X' })])).toEqual([])
    expect(summariseActivity([])).toEqual({ parts: [], more: 0 })
  })

  it('uses the newest level when the same skill moved more than once', () => {
    const events = [
      event({ event_type: 'skill_confirmed', level: 4, skill_name: 'Python', event_at: daysAgo(1) }),
      event({ event_type: 'skill_confirmed', level: 3, skill_name: 'Python', event_at: daysAgo(9) }),
    ]
    expect(summariseActivity(events).parts).toEqual([{ key: 'reachedOne', params: { skill: 'Python', level: 4 } }])
  })
})
