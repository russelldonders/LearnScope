vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import ProviderSharingPanel from './ProviderSharingPanel'
import * as api from '../lib/providerSharing'
vi.mock('../lib/providerSharing', async importOriginal => ({ ...await importOriginal(), listSharingConnections: vi.fn(), listSharingEmployers: vi.fn(), listSharingCatalogues: vi.fn(), sendSharingRequest: vi.fn(), decideSharing: vi.fn(), removeSharing: vi.fn() }))
vi.mock('../lib/admin/organisations', () => ({ listOrganisations: vi.fn(async () => [{ id: 'provider', name: 'Training partner' }]) }))
afterEach(cleanup)
const employer = { id: 'employer', name: 'Acme', provider_organisation_id: 'main' }
const catalogues = [{ id: 'cat', name: 'Leadership', course_catalogue_publications: [{ published_at: '2026-09-12', course_catalogue: { id: 'course', name: 'Coaching', status: 'approved', is_current_published: true } }] }]
beforeEach(() => {
  vi.clearAllMocks()
  api.listSharingConnections.mockResolvedValue([])
  api.listSharingEmployers.mockResolvedValue([employer])
  api.listSharingCatalogues.mockResolvedValue(catalogues)
  api.sendSharingRequest.mockResolvedValue({})
  api.decideSharing.mockResolvedValue({})
})
describe('provider sharing', () => {
  it('always shows the same-name main provider with no removal action', async () => {
    render(<ProviderSharingPanel employer={employer} userId="user" />)
    await screen.findByText('No invitations awaiting your approval.')
    const main=screen.getByText('Acme').parentElement
    expect(within(main).getByText('Main provider · Permanent connection')).toBeInTheDocument()
    expect(within(main).queryByRole('button')).not.toBeInTheDocument()
  })
  it('sends a specific course request only after a valid selection', async () => {
    render(<ProviderSharingPanel employer={employer} userId="user" />)
    fireEvent.change(await screen.findByLabelText('Search providers by name'), { target: { value: 'Training' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select catalogues' }))
    await screen.findByLabelText('Leadership')
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Leadership'))
    fireEvent.click(screen.getByLabelText('All courses, including future additions and updates'))
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Coaching'))
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(api.sendSharingRequest).toHaveBeenCalledWith({ employerId:'employer',providerId:'provider',userId:'user',side:'employer',sharing:{ all:false,catalogues:[{ id:'cat',all:false,courses:['course'] }] } }))
  })
  it('shows incoming invitations and requires reviewing the selection before approval', async () => {
    api.listSharingConnections.mockResolvedValue([{ id:'link',provider_organisation_id:'provider',employer_id:'employer',status:'pending',initiated_by:'provider',sharing:{all:true,catalogues:[]} }])
    render(<ProviderSharingPanel employer={employer} userId="user" />)
    await screen.findByText('Provider invitations (1)')
    expect(screen.queryByRole('button',{name:'Approve sharing'})).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Review selection'}))
    fireEvent.click(await screen.findByRole('button',{name:'Approve sharing'}))
    await waitFor(() => expect(api.decideSharing).toHaveBeenCalledWith('link',true))
  })
  it('lets a provider invite an employer with all future catalogues enabled', async () => {
    render(<ProviderSharingPanel side="provider" organisation={{id:'provider',name:'Training partner'}} userId="user" />)
    fireEvent.change(await screen.findByLabelText('Search employers by name'),{target:{value:'Acme'}})
    fireEvent.click(screen.getByRole('button',{name:'Select catalogues'}))
    fireEvent.click(await screen.findByLabelText(/All catalogues and courses/))
    fireEvent.click(screen.getByRole('button',{name:'Send invitation'}))
    await waitFor(() => expect(api.sendSharingRequest).toHaveBeenCalledWith({employerId:'employer',providerId:'provider',userId:'user',side:'provider',sharing:{all:true,catalogues:[]}}))
  })
  it('keeps approval errors visible', async () => {
    api.listSharingConnections.mockResolvedValue([{ id:'link',provider_organisation_id:'provider',employer_id:'employer',status:'pending',initiated_by:'provider',sharing:{all:true,catalogues:[]} }])
    api.decideSharing.mockRejectedValue(new Error('This request has already been decided'))
    render(<ProviderSharingPanel employer={employer} userId="user" />)
    fireEvent.click(await screen.findByRole('button',{name:'Review selection'}))
    fireEvent.click(await screen.findByRole('button',{name:'Approve sharing'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('already been decided')
  })
})
