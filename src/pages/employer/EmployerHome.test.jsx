import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmployerHome from './EmployerHome'
import { normaliseWorkspaceSettings } from '../../lib/learnerWorkspaceSettings'

const settingsMock = vi.hoisted(() => vi.fn())

vi.mock('../../context/LanguageContext', () => import('../../test/languageMock'))

vi.mock('../../components/AppHeader', () => ({ default: (props) => <div data-testid="app-header" data-hidden={props.hideNavLinks} data-exit={props.contextExitHref} data-logo={props.brandLogoUrl} data-name={props.brandName} /> }))
vi.mock('../../lib/orgBranding', () => ({ orgBrandStyle: () => ({}) }))
vi.mock('../../lib/employerRoleProfiles', () => ({ getEmployerLoginContext: () => Promise.resolve({ id: 'employer-1', name: 'Acme Ltd', branding: { name: 'Acme Ltd', logoUrl: '/acme.png' } }) }))
vi.mock('../../lib/learnerWorkspaceSettings', async (importOriginal) => ({ ...(await importOriginal()), getLearnerWorkspaceSettings: settingsMock }))
vi.mock('./EmployerAssignedTrainingPanel', () => ({ default: (props) => <div data-testid="learning-panel" data-variant={props.variant || 'full'} data-framing={props.framing}>{props.employerName}</div> }))
vi.mock('./EmployerCataloguePanel', () => ({ default: (props) => <div data-testid="catalogue-panel" data-enrolment={props.enrolment}>{props.employerName}</div> }))
vi.mock('../roles/LearnerRoleAlignmentContainer', () => ({ default: (props) => <div data-testid="role-panel" data-variant={props.variant || 'full'} /> }))

beforeEach(() => settingsMock.mockResolvedValue(normaliseWorkspaceSettings(null)))
afterEach(cleanup)

describe('EmployerHome learner LMS navigation', () => {
  it('shows the focused employer home without the global navigation', async () => {
    render(<MemoryRouter initialEntries={['/organisation/learning?org=acme']}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByTestId('app-header')).toHaveAttribute('data-hidden', 'true')
    expect(screen.getByTestId('app-header')).toHaveAttribute('data-exit', '/dashboard')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-variant', 'home')
    expect(screen.getByTestId('role-panel')).toHaveAttribute('data-variant', 'summary')
  })

  it('switches between dedicated learning and role sections while preserving the organisation', async () => {
    render(<MemoryRouter initialEntries={['/organisation/learning?org=acme']}><EmployerHome /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Welcome back' })

    fireEvent.click(screen.getByRole('link', { name: 'My learning' }))
    expect(await screen.findByRole('heading', { name: 'My learning' })).toBeInTheDocument()
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-variant', 'full')
    expect(screen.getByRole('link', { name: 'My learning' })).toHaveAttribute('href', '/organisation/learning?org=acme&section=learning')

    fireEvent.click(screen.getByRole('link', { name: 'Role & skills' }))
    expect(await screen.findByRole('heading', { name: 'Role & skills' })).toBeInTheDocument()
    expect(screen.getByTestId('role-panel')).toHaveAttribute('data-variant', 'full')
  })

  it('opens the employer catalogue as a separate learner section', async () => {
    render(<MemoryRouter initialEntries={['/organisation/learning?org=acme&section=catalogue']}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Catalogue' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('catalogue-panel')).toHaveTextContent('Acme Ltd')
  })
})

describe('EmployerHome branding', () => {
  it('uses the members-only branding from the employer context', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/organisation/learning?org=acme']}><EmployerHome /></MemoryRouter>)

    await screen.findByRole('heading', { name: 'Welcome back' })
    expect(container.firstChild).toHaveClass('org-brand-scope')
    expect(screen.getByTestId('app-header')).toHaveAttribute('data-logo', '/acme.png')
    expect(screen.getByTestId('app-header')).toHaveAttribute('data-name', 'Acme Ltd')
  })
})

describe('EmployerHome follows the organisation’s workspace settings', () => {
  const customised = normaliseWorkspaceSettings({
    section_order: ['learning', 'home', 'catalogue', 'role'],
    hidden_sections: ['role'],
    landing_section: 'learning',
    section_labels: { learning: 'My development', home: 'Start here' },
    welcome_message: 'Welcome to Acme learning.',
    announcement: 'Fire safety refreshers are due this month.',
    contact_name: 'Sam Patel',
    contact_email: 'sam@acme.example',
    pinned_links: [{ label: 'Staff handbook', url: 'https://acme.example/handbook' }],
    catalogue_enrolment: 'browse_only',
    assigned_training_framing: 'required',
  })

  it('shows only the chosen sections, in order, with their names, landing where chosen', async () => {
    settingsMock.mockResolvedValue(customised)
    render(<MemoryRouter initialEntries={['/organisation/learning?org=acme']}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { level: 1, name: 'My development' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Employer learning' })
    expect([...nav.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['My development', 'Start here', 'Catalogue'])
    expect(screen.getByRole('link', { name: 'My development' })).toHaveAttribute('href', '/organisation/learning?org=acme')
    expect(screen.getByRole('link', { name: 'Start here' })).toHaveAttribute('href', '/organisation/learning?org=acme&section=home')
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-framing', 'required')
  })

  it('falls back to the landing section when a hidden section is requested', async () => {
    settingsMock.mockResolvedValue(customised)
    render(<MemoryRouter initialEntries={['/organisation/learning?org=acme&section=role']}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { level: 1, name: 'My development' })).toBeInTheDocument()
    expect(screen.queryByTestId('role-panel')).not.toBeInTheDocument()
  })

  it('shows the organisation’s welcome, announcement, contact and links on Home, without hidden sections', async () => {
    settingsMock.mockResolvedValue(customised)
    render(<MemoryRouter initialEntries={['/organisation/learning?org=acme&section=home']}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { level: 1, name: 'Start here' })).toBeInTheDocument()
    expect(screen.getByText('Welcome to Acme learning.')).toBeInTheDocument()
    expect(screen.getByText('Fire safety refreshers are due this month.')).toBeInTheDocument()
    expect(screen.getByText('Sam Patel')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'sam@acme.example' })).toHaveAttribute('href', 'mailto:sam@acme.example')
    const handbook = screen.getByRole('link', { name: /Staff handbook/ })
    expect(handbook).toHaveAttribute('href', 'https://acme.example/handbook')
    expect(handbook).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByTestId('learning-panel')).toHaveAttribute('data-variant', 'home')
    expect(screen.queryByTestId('role-panel')).not.toBeInTheDocument()
  })

  it('passes the catalogue rule to the catalogue', async () => {
    settingsMock.mockResolvedValue(customised)
    render(<MemoryRouter initialEntries={['/organisation/learning?org=acme&section=catalogue']}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByTestId('catalogue-panel')).toHaveAttribute('data-enrolment', 'browse_only')
  })
})
