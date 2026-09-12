vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProviderSharingPanel from './ProviderSharingPanel'
import * as api from '../lib/providerSharing'

vi.mock('../lib/providerSharing', async (importOriginal) => ({
  ...await importOriginal(),
  listSharingConnections: vi.fn(),
  listSharingEmployers: vi.fn(),
  listSharingCatalogues: vi.fn(),
  sendSharingRequest: vi.fn(),
  updateSharingSelection: vi.fn(),
  decideSharing: vi.fn(),
  removeSharing: vi.fn(),
}))
vi.mock('../lib/admin/organisations', () => ({
  listOrganisations: vi.fn(async () => [
    { id: 'main', name: 'Acme Learning' },
    { id: 'provider', name: 'Training partner' },
  ]),
}))

afterEach(cleanup)

const employer = { id: 'employer', name: 'Acme', provider_organisation_id: 'main' }
const catalogues = [{
  id: 'cat',
  name: 'Leadership',
  course_catalogue_publications: [{
    published_at: '2026-09-12',
    course_catalogue: { id: 'course', name: 'Coaching', status: 'approved', is_current_published: true },
  }],
}]

beforeEach(() => {
  vi.clearAllMocks()
  api.listSharingConnections.mockResolvedValue([])
  api.listSharingEmployers.mockResolvedValue([employer])
  api.listSharingCatalogues.mockResolvedValue(catalogues)
  api.sendSharingRequest.mockResolvedValue({})
  api.updateSharingSelection.mockResolvedValue({})
  api.decideSharing.mockResolvedValue({})
})

describe('provider sharing', () => {
  it('shows one linked-provider list containing the main and accepted providers', async () => {
    api.listSharingConnections.mockResolvedValue([{
      id: 'link',
      provider_organisation_id: 'provider',
      employer_id: 'employer',
      status: 'accepted',
      initiated_by: 'provider',
      sharing: { all: true, catalogues: [] },
    }])
    render(<ProviderSharingPanel employer={employer} userId="user" />)

    const list = await screen.findByRole('list')
    expect(within(list).getByText('Acme Learning')).toBeInTheDocument()
    expect(within(list).getByText('Training partner')).toBeInTheDocument()
    expect(within(list).getByText(/Main provider/)).toBeInTheDocument()
    expect(screen.queryByText('Provider invitations')).not.toBeInTheDocument()
    expect(screen.queryByText('Sent requests')).not.toBeInTheDocument()
  })

  it('sends a specific course request only after a valid selection', async () => {
    render(<ProviderSharingPanel employer={employer} userId="user" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Link a provider' }))
    fireEvent.change(screen.getByLabelText('Search providers by name'), { target: { value: 'Training' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select catalogues' }))
    await screen.findByLabelText('Leadership')
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Leadership'))
    fireEvent.click(screen.getByLabelText('All courses, including future additions and updates'))
    fireEvent.click(screen.getByLabelText('Coaching'))
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(api.sendSharingRequest).toHaveBeenCalledWith({
      employerId: 'employer',
      providerId: 'provider',
      userId: 'user',
      side: 'employer',
      sharing: { all: false, catalogues: [{ id: 'cat', all: false, courses: ['course'] }] },
    }))
  })

  it('only shows the invitation section when an incoming request exists', async () => {
    const row = {
      id: 'link',
      provider_organisation_id: 'provider',
      employer_id: 'employer',
      status: 'pending',
      initiated_by: 'provider',
      sharing: { all: true, catalogues: [] },
    }
    api.listSharingConnections.mockResolvedValue([row])
    render(<ProviderSharingPanel employer={employer} userId="user" />)

    expect(await screen.findByText('Provider invitations')).toBeInTheDocument()
    expect(screen.queryByText('Sent requests')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review selection' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve sharing' }))
    await waitFor(() => expect(api.decideSharing).toHaveBeenCalledWith(row, true))
  })

  it('shows outgoing requests only in the pending sent list', async () => {
    api.listSharingConnections.mockResolvedValue([{
      id: 'link',
      provider_organisation_id: 'provider',
      employer_id: 'employer',
      status: 'pending',
      initiated_by: 'employer',
      sharing: { all: true, catalogues: [] },
    }])
    render(<ProviderSharingPanel employer={employer} userId="user" />)

    expect(await screen.findByText('Sent requests')).toBeInTheDocument()
    expect(screen.queryByText('Provider invitations')).not.toBeInTheDocument()
  })

  it('edits an accepted selection as a new approval request', async () => {
    const row = {
      id: 'link',
      provider_organisation_id: 'provider',
      employer_id: 'employer',
      status: 'accepted',
      initiated_by: 'provider',
      sharing: { all: true, catalogues: [] },
    }
    api.listSharingConnections.mockResolvedValue([row])
    render(<ProviderSharingPanel employer={employer} userId="user" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Update selection' }))
    fireEvent.click(await screen.findByLabelText(/All catalogues and courses/))
    fireEvent.click(screen.getByLabelText('Leadership'))
    fireEvent.click(screen.getByLabelText('All courses, including future additions and updates'))
    fireEvent.click(screen.getByLabelText('Coaching'))
    fireEvent.click(screen.getByRole('button', { name: 'Send changes for approval' }))
    await waitFor(() => expect(api.updateSharingSelection).toHaveBeenCalledWith(
      row,
      { all: false, catalogues: [{ id: 'cat', all: false, courses: ['course'] }] },
      'employer',
    ))
  })

  it('reviews a pending selection update within the linked-provider list', async () => {
    const row = {
      id: 'link',
      provider_organisation_id: 'provider',
      employer_id: 'employer',
      status: 'accepted',
      initiated_by: 'employer',
      sharing: { all: false, catalogues: [{ id: 'cat', all: false, courses: ['course'] }] },
      pending_sharing: { all: true, catalogues: [] },
      pending_initiated_by: 'provider',
    }
    api.listSharingConnections.mockResolvedValue([row])
    render(<ProviderSharingPanel employer={employer} userId="user" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Review update' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve update' }))
    await waitFor(() => expect(api.decideSharing).toHaveBeenCalledWith(row, true))
    expect(screen.queryByText('Provider invitations')).not.toBeInTheDocument()
    expect(screen.queryByText('Sent requests')).not.toBeInTheDocument()
  })

  it('lets a provider invite an employer with all future catalogues enabled', async () => {
    render(<ProviderSharingPanel side="provider" organisation={{ id: 'provider', name: 'Training partner' }} userId="user" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Link an employer' }))
    fireEvent.change(screen.getByLabelText('Search employers by name'), { target: { value: 'Acme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select catalogues' }))
    fireEvent.click(await screen.findByLabelText(/All catalogues and courses/))
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(api.sendSharingRequest).toHaveBeenCalledWith({
      employerId: 'employer',
      providerId: 'provider',
      userId: 'user',
      side: 'provider',
      sharing: { all: true, catalogues: [] },
    }))
  })
})
