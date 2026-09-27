import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrganisationAdminRoute from './OrganisationAdminRoute'

const authMock = vi.hoisted(() => ({
  value: { organisationMemberships: [], employerMemberships: [] },
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => authMock.value }))
vi.mock('./ProtectedRoute', () => ({ default: ({ children }) => children }))

afterEach(() => {
  cleanup()
  authMock.value = { organisationMemberships: [], employerMemberships: [] }
})

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/organisation']}>
      <Routes>
        <Route path="/organisation" element={<OrganisationAdminRoute><p>Workspace</p></OrganisationAdminRoute>} />
        <Route path="/dashboard" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OrganisationAdminRoute', () => {
  it('accepts learning-content organisation members', () => {
    authMock.value.organisationMemberships = [{ organisation_id: 'org-1', role: 'trainer' }]
    renderRoute()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('accepts employer administrators', () => {
    authMock.value.employerMemberships = [{ employer_id: 'employer-1', role: 'admin' }]
    renderRoute()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
  })

  it('rejects ordinary employer members', () => {
    authMock.value.employerMemberships = [{ employer_id: 'employer-1', role: 'member' }]
    renderRoute()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })
})
