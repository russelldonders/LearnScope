import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrganisationWorkspace from './OrganisationWorkspace'

const authMock = vi.hoisted(() => ({ employerMemberships: [] }))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => authMock }))
vi.mock('../employer/EmployerConsole', () => ({ default: () => <h1>People capability</h1> }))

afterEach(() => {
  cleanup()
  authMock.employerMemberships = []
})

describe('OrganisationWorkspace', () => {
  it('opens the unified console for a workforce organisation', () => {
    authMock.employerMemberships = [{ employer_id: 'employer-1', role: 'admin' }]
    render(<MemoryRouter initialEntries={['/organisation?org=employer-1']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'People capability' })).toBeInTheDocument()
  })

  it('opens the same unified console for a learning organisation', () => {
    render(<MemoryRouter initialEntries={['/organisation?org=org-1']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'People capability' })).toBeInTheDocument()
  })

  it('does not reintroduce a legacy employer console route', () => {
    authMock.employerMemberships = [{ employer_id: 'employer-1', role: 'admin' }]
    render(<MemoryRouter initialEntries={['/organisation?employer=employer-2&org=org-1']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'People capability' })).toBeInTheDocument()
  })

  it('defaults an employer administrator to their organisation workspace', () => {
    authMock.employerMemberships = [{ employer_id: 'employer-1', role: 'admin' }]
    render(<MemoryRouter initialEntries={['/organisation']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'People capability' })).toBeInTheDocument()
  })
})
