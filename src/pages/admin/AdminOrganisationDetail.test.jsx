import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminOrganisationDetail from './AdminOrganisationDetail'
import * as organisations from '../../lib/admin/organisations'
import { listOrganisationCatalogueCourses } from '../../lib/admin/catalogue'

vi.mock('./AdminLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../context/LanguageContext', () => import('../../test/languageMock'))
vi.mock('./AdminProviders', () => ({
  OrganisationStaffPanel: ({ organisation }) => <p>Staff panel for {organisation.name}</p>,
}))
vi.mock('../../lib/admin/organisations', () => ({
  getOrganisation: vi.fn(),
  updateOrganisation: vi.fn().mockResolvedValue({}),
  setOrganisationCapabilities: vi.fn().mockResolvedValue(),
  setOrganisationStatus: vi.fn().mockResolvedValue(),
}))
vi.mock('../../lib/admin/catalogue', () => ({ listOrganisationCatalogueCourses: vi.fn() }))

const ORG = {
  id: 'org-1',
  name: 'BHFC',
  org_code: 'ORG-1',
  url: 'https://bhfc.example',
  status: 'active',
  is_system: false,
  organisation_capabilities: [{ capability: 'authors_learning', status: 'active' }],
}

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  organisations.getOrganisation.mockResolvedValue(ORG)
  listOrganisationCatalogueCourses.mockResolvedValue([
    { id: 'course-1', name: 'Coaching basics', status: 'approved', updated_at: '2026-11-01T10:00:00Z' },
  ])
})

function renderAt(url = '/admin/organisations/org-1') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/organisations/:organisationId" element={<AdminOrganisationDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminOrganisationDetail', () => {
  it('shows the organisation with its details form first', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'BHFC' })).toBeInTheDocument()
    expect(screen.getByText('ORG-1')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('BHFC')
    expect(screen.getByRole('checkbox', { name: 'Authors learning' })).toBeChecked()
  })

  it('saves name, website and capabilities together', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'BHFC' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BHFC Academy' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Employs people' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(organisations.updateOrganisation)
      .toHaveBeenCalledWith('org-1', { name: 'BHFC Academy', url: 'https://bhfc.example' }))
    expect(organisations.setOrganisationCapabilities).toHaveBeenCalledWith('org-1', ['employs_people', 'authors_learning'])
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
  })

  it('opens the tab named in the link', async () => {
    renderAt('/admin/organisations/org-1?tab=staff')
    expect(await screen.findByText('Staff panel for BHFC')).toBeInTheDocument()
  })

  it("lists the organisation's courses", async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'BHFC' })
    fireEvent.click(screen.getByRole('button', { name: 'Courses' }))
    expect(await screen.findByRole('link', { name: 'Coaching basics' })).toHaveAttribute('href', '/admin/courses/course-1')
    expect(screen.getByRole('link', { name: 'Open in Courses' })).toHaveAttribute('href', '/admin/courses?org=org-1')
  })

  it('deactivates after confirmation', async () => {
    renderAt('/admin/organisations/org-1?tab=status')
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate organisation' }))
    expect(organisations.setOrganisationStatus).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(organisations.setOrganisationStatus).toHaveBeenCalledWith('org-1', 'inactive'))
  })

  it("won't deactivate the system organisation", async () => {
    organisations.getOrganisation.mockResolvedValue({ ...ORG, is_system: true })
    renderAt('/admin/organisations/org-1?tab=status')
    expect(await screen.findByText("The system organisation can't be deactivated.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate organisation' })).not.toBeInTheDocument()
  })

  it('says when the organisation cannot be found', async () => {
    organisations.getOrganisation.mockRejectedValue(new Error('Organisation not found.'))
    renderAt()
    expect(await screen.findByText('Organisation not found.')).toBeInTheDocument()
  })
})
