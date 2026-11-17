import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerConsole from './EmployerConsole'

const authMock = vi.hoisted(() => ({
  user: { id: 'admin-1' },
  employerMemberships: [{ employer_id: 'org-employer', role: 'admin' }],
  organisationMemberships: [
    { organisation_id: 'org-employer', role: 'admin' },
    { organisation_id: 'org-provider', role: 'admin' },
  ],
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => authMock }))
vi.mock('../../lib/admin/organisations', () => ({
  listOrganisations: vi.fn().mockResolvedValue([
    {
      id: 'org-employer',
      name: 'Leeds United',
      status: 'active',
      organisation_capabilities: [{ capability: 'employs_people', status: 'active' }],
    },
    {
      id: 'org-provider',
      name: 'BHFC',
      status: 'active',
      organisation_capabilities: [{ capability: 'authors_learning', status: 'active' }],
    },
  ]),
}))

// Heavy panels aren't under test here -- just which one is showing.
vi.mock('../../components/AppHeader', () => ({ default: () => null }))
vi.mock('../../components/ProviderSharingPanel', () => ({
  default: ({ side }) => <p>{side === 'provider' ? 'Linked employers panel' : 'Linked providers panel'}</p>,
}))
vi.mock('../../components/ResourceLibrarySection', () => ({ default: () => null }))
vi.mock('../../components/ProviderSkillsSection', () => ({ default: () => null }))
vi.mock('../../components/ProviderLtiToolsSection', () => ({ default: () => null }))
vi.mock('../provider/ProviderConsole', () => ({ ProviderTrainingSection: () => null, ProviderCataloguesSection: () => null }))
vi.mock('./EmployerMemberFieldsDialog', () => ({ default: () => <div role="dialog" aria-label="Member fields" /> }))
vi.mock('./EmployerRoleProfilesSection', () => ({ default: () => null }))
vi.mock('./EmployerOverviewPanel', () => ({ default: () => <p>Overview panel</p> }))
vi.mock('./EmployerManagementSection', () => ({ default: () => null }))
vi.mock('./EmployerCatalogueAccessPanel', () => ({ default: () => null }))
vi.mock('../provider/ProviderOverviewPanel', () => ({ default: () => <p>Overview panel</p> }))
vi.mock('../../components/OrganisationSettingsModal', () => ({ default: () => <div role="dialog" aria-label="Organisation details" /> }))
vi.mock('../admin/AdminProviders', () => ({ OrganisationStaffPanel: () => null }))
vi.mock('./EmployerLearnersPanel', () => ({ EmployerLearnersPanel: () => null }))

afterEach(cleanup)

function renderAt(url) {
  render(<MemoryRouter initialEntries={[url]}><EmployerConsole /></MemoryRouter>)
}

describe('EmployerConsole Settings menu', () => {
  it('replaces the cog with a text Settings menu of sub-items', async () => {
    renderAt('/organisation?org=org-employer')
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(names.some((n) => n.startsWith('Organisation details'))).toBe(true)
    expect(names.some((n) => n.startsWith('LMS connections'))).toBe(true)
    expect(names.some((n) => n.startsWith('LTI tools'))).toBe(true)
    expect(names.some((n) => n.startsWith('Linked providers'))).toBe(true)
    expect(names.some((n) => n.startsWith('Member fields'))).toBe(true)
  })

  it('opens member fields straight from its menu item', async () => {
    renderAt('/organisation?org=org-employer')
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Member fields/ }))
    expect(screen.getByRole('dialog', { name: 'Member fields' })).toBeInTheDocument()
  })

  it('moves linked providers from the Distribution tab into Settings for an employer', async () => {
    renderAt('/organisation?org=org-employer')
    await screen.findByRole('button', { name: 'Settings' })
    expect(screen.queryByRole('tab', { name: 'Distribution' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Linked providers/ }))
    expect(await screen.findByText('Linked providers panel')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '0')
  })

  it('keeps the Distribution tab for an organisation that only provides training', async () => {
    renderAt('/organisation?org=org-provider')
    expect(await screen.findByRole('tab', { name: 'Distribution' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.queryByRole('menuitem', { name: /Linked providers/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Member fields/ })).not.toBeInTheDocument()
  })
})
