import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminProviders from './AdminProviders'
import { listOrganisations } from '../../lib/admin/organisations'
import { listOrganisationIdsWithPendingInvitations } from '../../lib/admin/overview'

vi.mock('./AdminLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../context/LanguageContext', () => import('../../test/languageMock'))
vi.mock('../../lib/admin/organisations', () => ({
  listOrganisations: vi.fn(),
  createOrganisation: vi.fn(),
  setOrganisationStatus: vi.fn(),
  listOrganisationMembers: vi.fn().mockResolvedValue([]),
  removeOrganisationMember: vi.fn(),
  inviteOrganisationStaff: vi.fn(),
}))
vi.mock('../../lib/admin/overview', () => ({ listOrganisationIdsWithPendingInvitations: vi.fn() }))

const ORGS = [
  { id: 'org-1', name: 'BHFC', org_code: 'A1', status: 'active', organisation_capabilities: [] },
  { id: 'org-2', name: 'Leeds United', org_code: 'A2', status: 'active', organisation_capabilities: [] },
]

afterEach(() => {
  cleanup()
  localStorage.clear()
})
beforeEach(() => {
  listOrganisations.mockResolvedValue(ORGS)
  listOrganisationIdsWithPendingInvitations.mockResolvedValue(['org-2'])
})

function renderAt(url = '/admin/organisations') {
  render(<MemoryRouter initialEntries={[url]}><AdminProviders /></MemoryRouter>)
}

describe('AdminProviders (organisations list)', () => {
  it("links each organisation's name to its own page instead of editing in the row", async () => {
    renderAt()
    expect(await screen.findByRole('link', { name: 'BHFC' })).toHaveAttribute('href', '/admin/organisations/org-1')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage users' })).not.toBeInTheDocument()
  })

  it('filters to organisations with pending staff invitations, and can clear it', async () => {
    renderAt('/admin/organisations?invites=pending')
    expect(await screen.findByRole('link', { name: 'Leeds United' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'BHFC' })).not.toBeInTheDocument()
    expect(screen.getByText('With pending staff invitations')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop filtering by pending staff invitations' }))
    expect(await screen.findByRole('link', { name: 'BHFC' })).toBeInTheDocument()
  })
})
