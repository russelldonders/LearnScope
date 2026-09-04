import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Help from './Help'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ signOut: vi.fn(), user: { id: 'user-1' }, isPlatformAdmin: false, organisationMemberships: [], employerMemberships: [] }),
}))
vi.mock('../context/PendingActionsContext', () => ({
  usePendingActions: () => ({ pendingActionCount: 0, refreshPendingActionCount: vi.fn() }),
}))
vi.mock('../context/NavVisibilityContext', () => ({
  useNavVisibility: () => ({ navVisibility: {} }),
}))
vi.mock('../lib/supabaseClient', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }) },
}))

afterEach(cleanup)

function renderHelp() {
  return render(
    <MemoryRouter initialEntries={['/help']}>
      <Help />
    </MemoryRouter>
  )
}

describe('Help', () => {
  it('defaults to the learner perspective', () => {
    renderHelp()
    expect(screen.getByRole('tab', { name: 'As a learner', selected: true })).toBeInTheDocument()
    expect(screen.getByText(/Your profile is yours/)).toBeInTheDocument()
  })

  it('switches to the manager perspective and shows manager-specific content', () => {
    renderHelp()
    fireEvent.click(screen.getByRole('tab', { name: 'As a manager' }))
    expect(screen.getByText(/not an employer role/)).toBeInTheDocument()
    expect(screen.queryByText(/Your profile is yours/)).not.toBeInTheDocument()
  })

  it('switches to the employer perspective and shows employer-specific content', () => {
    renderHelp()
    fireEvent.click(screen.getByRole('tab', { name: 'As an employer admin' }))
    expect(screen.getByText(/kept separate/)).toBeInTheDocument()
  })

  it('moves between tabs with arrow keys', () => {
    renderHelp()
    const learnerTab = screen.getByRole('tab', { name: 'As a learner' })
    learnerTab.focus()
    fireEvent.keyDown(learnerTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'As a manager', selected: true })).toBeInTheDocument()
  })
})
