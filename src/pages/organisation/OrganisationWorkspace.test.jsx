import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrganisationWorkspace from './OrganisationWorkspace'

const authMock = vi.hoisted(() => ({ employerMemberships: [] }))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => authMock }))
vi.mock('../employer/EmployerConsole', () => ({ default: () => <h1>People capability</h1> }))
vi.mock('../provider/ProviderConsole', () => ({ default: () => <h1>Learning content capability</h1> }))

afterEach(() => {
  cleanup()
  authMock.employerMemberships = []
})

describe('OrganisationWorkspace', () => {
  it('opens the people capability for an employer-backed organisation', () => {
    authMock.employerMemberships = [{ employer_id: 'employer-1', role: 'admin' }]
    render(<MemoryRouter initialEntries={['/organisation?employer=employer-1']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'People capability' })).toBeInTheDocument()
  })

  it('opens learning content for an independent organisation', () => {
    render(<MemoryRouter initialEntries={['/organisation?org=org-1']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Learning content capability' })).toBeInTheDocument()
  })

  it('does not open another employer organisation from a forged query', () => {
    authMock.employerMemberships = [{ employer_id: 'employer-1', role: 'admin' }]
    render(<MemoryRouter initialEntries={['/organisation?employer=employer-2&org=org-1']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Learning content capability' })).toBeInTheDocument()
  })

  it('defaults an employer administrator to their organisation workspace', () => {
    authMock.employerMemberships = [{ employer_id: 'employer-1', role: 'admin' }]
    render(<MemoryRouter initialEntries={['/organisation']}><OrganisationWorkspace /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'People capability' })).toBeInTheDocument()
  })
})
