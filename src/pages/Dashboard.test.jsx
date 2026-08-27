import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))

import { FocusPanel, OverviewStrip } from './Dashboard'

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
