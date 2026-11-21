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
vi.mock('../../components/WorkspacePanels', () => ({
  GoalsPanel: (props) => <div data-testid="goals-panel" data-org={props.organisationId} data-limit={props.block.limit} />,
  SkillsPanel: (props) => <div data-testid="skills-panel" data-org={props.organisationId} />,
  PlansPanel: (props) => <div data-testid="plans-panel" data-org={props.organisationId} data-framing={props.framing} />,
  SampleGoalsPanel: () => null,
  SampleSkillsPanel: () => null,
  SamplePlansPanel: () => null,
}))
vi.mock('../../components/AssignedPlansList', () => ({ default: (props) => <div data-testid="assigned-plans" data-org={props.organisationId} data-heading={props.heading} /> }))
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
    expect(screen.getByTestId('assigned-plans')).toHaveAttribute('data-org', 'employer-1')
    expect(screen.getByTestId('assigned-plans')).toHaveAttribute('data-heading', 'Plans from Acme Ltd')
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

describe('EmployerHome shows the organisation’s own sections', () => {
  const benefits = 'page-11111111-1111-4111-8111-111111111111'
  const policies = 'page-22222222-2222-4222-8222-222222222222'
  const withPages = normaliseWorkspaceSettings({
    custom_pages: [
      { id: benefits, title: 'Benefits', content: { version: 1, blocks: [{ id: 'b1', type: 'heading', level: 2, content: 'Your benefits' }, { id: 'b2', type: 'text', content: 'Pension details<img src=x onerror="alert(1)">' }] } },
      { id: policies, title: 'Policies', content: { version: 1, blocks: [] } },
    ],
    section_order: ['home', benefits, 'learning', 'catalogue', 'role', policies],
  })

  it('lists them in the nav and opens their content', async () => {
    settingsMock.mockResolvedValue(withPages)
    render(<MemoryRouter initialEntries={[`/organisation/learning?org=acme&section=${benefits}`]}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { level: 1, name: 'Benefits' })).toBeInTheDocument()
    expect(screen.getByText('Your benefits')).toBeInTheDocument()
    expect(screen.getByText('Pension details')).toBeInTheDocument()
    expect(document.querySelector('main [onerror]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Benefits' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Policies' })).toHaveAttribute('href', `/organisation/learning?org=acme&section=${policies}`)
  })

  it('says so when a section has no content yet', async () => {
    settingsMock.mockResolvedValue(withPages)
    render(<MemoryRouter initialEntries={[`/organisation/learning?org=acme&section=${policies}`]}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByRole('heading', { level: 1, name: 'Policies' })).toBeInTheDocument()
    expect(screen.getByText('Nothing has been added here yet.')).toBeInTheDocument()
  })

  it('shows its LearnScope panels with this organisation’s records', async () => {
    settingsMock.mockResolvedValue(normaliseWorkspaceSettings({
      custom_pages: [{ id: benefits, title: 'Progress', content: { version: 1, blocks: [
        { id: 'p1', type: 'goals_panel', title: '', limit: 3, show: 'active' },
        { id: 'p2', type: 'skills_panel', title: '', limit: 5 },
        { id: 'p3', type: 'plans_panel', title: '', limit: 5 },
      ] } }],
      section_order: ['home', benefits, 'learning', 'catalogue', 'role'],
    }))
    render(<MemoryRouter initialEntries={[`/organisation/learning?org=acme&section=${benefits}`]}><EmployerHome /></MemoryRouter>)

    expect(await screen.findByTestId('goals-panel')).toHaveAttribute('data-org', 'employer-1')
    expect(screen.getByTestId('goals-panel')).toHaveAttribute('data-limit', '3')
    expect(screen.getByTestId('skills-panel')).toHaveAttribute('data-org', 'employer-1')
    expect(screen.getByTestId('plans-panel')).toHaveAttribute('data-org', 'employer-1')
  })
})
