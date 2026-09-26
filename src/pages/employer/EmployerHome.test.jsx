import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerHome from './EmployerHome'

vi.mock('../../components/AppHeader', () => ({ default: (props) => <div data-testid="app-header" data-hidden={props.hideNavLinks} data-exit={props.contextExitHref} /> }))
vi.mock('../../lib/orgBranding', () => ({ getOrganisationBranding: () => Promise.resolve({ name: 'Acme', logoUrl: '/acme.png' }), orgBrandStyle: () => ({}) }))
vi.mock('../../lib/employerRoleProfiles', () => ({ getEmployerLoginContext: () => Promise.resolve({ id: 'employer-1', name: 'Acme Ltd' }) }))
vi.mock('./EmployerAssignedTrainingPanel', () => ({ default: (props) => <div data-testid="learning-panel" data-variant={props.variant || 'full'}>{props.employerName}</div> }))
vi.mock('../roles/LearnerRoleAlignmentContainer', () => ({ default: (props) => <div data-testid="role-panel" data-variant={props.variant || 'full'} /> }))

afterEach(cleanup)

describe('EmployerHome learner LMS navigation', () => {
  it('shows the focused employer home without the global navigation', async () => {
    render(<MemoryRouter initialEntries={['/employer/home?org=acme']}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByTestId('app-header')).toHaveAttribute('data-hidden', 'true')
    expect(screen.getByTestId('app-header')).toHaveAttribute('data-exit', '/dashboard')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-variant', 'home')
    expect(screen.getByTestId('role-panel')).toHaveAttribute('data-variant', 'summary')
  })

  it('switches between dedicated learning and role sections while preserving the organisation', async () => {
    render(<MemoryRouter initialEntries={['/employer/home?org=acme']}><EmployerHome /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Welcome back' })

    fireEvent.click(screen.getByRole('link', { name: 'My learning' }))
    expect(await screen.findByRole('heading', { name: 'My learning' })).toBeInTheDocument()
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-variant', 'full')
    expect(screen.getByRole('link', { name: 'My learning' })).toHaveAttribute('href', '/employer/home?org=acme&section=learning')

    fireEvent.click(screen.getByRole('link', { name: 'Role & skills' }))
    expect(await screen.findByRole('heading', { name: 'Role & skills' })).toBeInTheDocument()
    expect(screen.getByTestId('role-panel')).toHaveAttribute('data-variant', 'full')
  })
})
