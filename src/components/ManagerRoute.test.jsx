import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ManagerRoute from './ManagerRoute'

const authState = { managerContexts: null, managerContextsError: null, refreshManagerContexts: vi.fn() }

vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }))
vi.mock('./ProtectedRoute', () => ({ default: ({ children }) => children }))

function renderRoute() {
  render(
    <MemoryRouter initialEntries={['/team']}>
      <Routes>
        <Route path="/team" element={<ManagerRoute><div>Manager workspace</div></ManagerRoute>} />
        <Route path="/dashboard" element={<div>Learner dashboard</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ManagerRoute', () => {
  it('waits until relationship-derived contexts resolve', () => {
    authState.managerContexts = null
    authState.managerContextsError = null
    renderRoute()
    expect(screen.getByText('Checking team access…')).toBeInTheDocument()
  })

  it('redirects a user with no active management relationships', () => {
    authState.managerContexts = []
    authState.managerContextsError = null
    renderRoute()
    expect(screen.getByText('Learner dashboard')).toBeInTheDocument()
  })

  it('lets a manager retry a failed access check', () => {
    authState.managerContexts = []
    authState.managerContextsError = new Error('Unavailable')
    renderRoute()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(authState.refreshManagerContexts).toHaveBeenCalledOnce()
  })

  it('renders the manager workspace for an active context', () => {
    authState.managerContexts = [{ employerId: 'employer-1' }]
    authState.managerContextsError = null
    renderRoute()
    expect(screen.getByText('Manager workspace')).toBeInTheDocument()
  })
})
