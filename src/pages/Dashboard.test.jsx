import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))

import { ConnectionsActivityFeed, FocusPanel, OverviewStrip } from './Dashboard'

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('dashboard focus hierarchy', () => {
  it('turns the first recommendation into one specific primary action', () => {
    renderWithRouter(
      <FocusPanel
        recommendation={{
          skill: { id: 'skill-1', name: 'Facilitation' },
          item: {
            label: 'Add practical evidence',
            description: 'Capture an example from your recent work.',
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Add practical evidence' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Continue with Facilitation/ })).toHaveAttribute(
      'href',
      '/skills/skill-1',
    )
  })

  it('offers a useful fallback when every skill recommendation is complete', () => {
    renderWithRouter(<FocusPanel />)

    expect(screen.getByRole('heading', { name: 'Choose where to grow next' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Review your skills/ })).toHaveAttribute('href', '/skills')
  })

  it('keeps inventory as navigable supporting context', () => {
    renderWithRouter(
      <OverviewStrip counts={{ skills: 4, experience: 2, courses: 3, connections: 6 }} />,
    )

    expect(screen.getByRole('link', { name: /4\s*Skills\s*tracked/ })).toHaveAttribute('href', '/skills')
    expect(screen.getByRole('link', { name: /6\s*Connections\s*people/ })).toHaveAttribute(
      'href',
      '/connections',
    )
  })
})

describe('connections activity grouping', () => {
  const sharedEvent = {
    actor_id: 'person-1',
    full_name: 'Alex Morgan',
    avatar_url: null,
    event_type: 'skill_added',
    level: null,
    detail: null,
  }

  it('groups the same milestone across skills and keeps the newest skill first', () => {
    const events = [
      { ...sharedEvent, event_at: '2026-08-29T10:00:00Z', skill_name: 'Interior Design' },
      { ...sharedEvent, event_at: '2026-08-29T09:00:00Z', skill_name: 'Colour Theory' },
      { ...sharedEvent, event_at: '2026-08-29T08:00:00Z', skill_name: 'Sketching' },
      { ...sharedEvent, event_at: '2026-08-29T07:00:00Z', skill_name: 'Lighting Design' },
    ]

    renderWithRouter(<ConnectionsActivityFeed events={events} />)
    expect(
      screen.getByText((_, element) =>
        element?.tagName === 'P' &&
        element.textContent === 'Alex Morgan started tracking Interior Design and 3 other skills'
      ),
    ).toBeInTheDocument()
  })

  it('keeps different people, milestones, and non-skill activity separate', () => {
    const events = [
      { ...sharedEvent, event_at: '2026-08-29T10:00:00Z', skill_name: 'Interior Design' },
      { ...sharedEvent, actor_id: 'person-2', event_at: '2026-08-29T09:00:00Z', skill_name: 'Sketching' },
      { ...sharedEvent, event_type: 'target_set', level: 3, event_at: '2026-08-29T08:00:00Z', skill_name: 'Lighting' },
      { ...sharedEvent, event_type: 'course_started', event_at: '2026-08-29T07:00:00Z', skill_name: null, detail: 'Design Basics' },
    ]

    const { container } = renderWithRouter(<ConnectionsActivityFeed events={events} />)
    expect(container.querySelectorAll('span.font-medium')).toHaveLength(4)
    expect(
      screen.getByText((_, element) =>
        element?.tagName === 'P' && element.textContent === 'Alex Morgan started Design Basics'
      ),
    ).toBeInTheDocument()
  })
})
