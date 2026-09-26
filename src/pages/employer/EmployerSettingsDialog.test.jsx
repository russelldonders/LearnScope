import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import EmployerSettingsDialog from './EmployerSettingsDialog'
import { listFieldDefinitionsForEmployer } from '../../lib/admin/employers'

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }))

vi.mock('../../lib/admin/employers', async (original) => ({
  ...await original(),
  listFieldDefinitionsForEmployer: vi.fn(),
  createFieldDefinition: vi.fn(),
  updateFieldDefinition: vi.fn(),
  deleteFieldDefinition: vi.fn(),
  reorderFieldDefinitions: vi.fn(),
}))

vi.mock('../../components/FieldDefinitionsManager', () => ({
  default: () => <div>Custom field manager</div>,
}))

vi.mock('../../components/OrganisationSettingsModal', () => ({
  default: ({ learnerPortal, onClose }) => (
    <div role="dialog" aria-label="Organisation settings" data-learner-name={learnerPortal?.name}>
      <button type="button" onClick={onClose}>Back from organisation settings</button>
    </div>
  ),
}))

const employer = { id: 'employer-1', name: 'Acme' }
const providerOrganisation = { id: 'org-1', name: 'Acme provider' }

beforeEach(() => {
  vi.clearAllMocks()
  listFieldDefinitionsForEmployer.mockResolvedValue([
    { id: 'base-email', employer_id: null, label: 'Email', field_type: 'email', required: true },
    { id: 'custom-team', employer_id: employer.id, label: 'Team', field_type: 'text', required: false, sort_order: 1000 },
  ])
})

afterEach(cleanup)

it('offers member fields from the settings cog menu and opens the existing manager', async () => {
  render(
    <EmployerSettingsDialog
      employer={employer}
      userId="admin-1"
      providerOrganisation={providerOrganisation}
      canManageOrganisation
      onClose={vi.fn()}
    />
  )

  expect(screen.getByRole('button', { name: /Organisation settings/ })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Member fields/ }))

  expect(await screen.findByText('Email')).toBeVisible()
  expect(screen.getByText('Custom field manager')).toBeVisible()
  expect(listFieldDefinitionsForEmployer).toHaveBeenCalledWith(employer.id)

  fireEvent.click(screen.getByRole('button', { name: '← Back to settings' }))
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
})

it('keeps member fields available when organisation settings require a separate provider-admin role', () => {
  render(
    <EmployerSettingsDialog
      employer={employer}
      userId="admin-1"
      providerOrganisation={providerOrganisation}
      canManageOrganisation={false}
      onClose={vi.fn()}
    />
  )

  expect(screen.queryByRole('button', { name: /Organisation settings/ })).toBeNull()
  expect(screen.getByRole('button', { name: /Member fields/ })).toBeVisible()
})

it('returns from organisation settings to the shared settings menu', () => {
  const onOrganisationUpdated = vi.fn()
  render(
    <EmployerSettingsDialog
      employer={employer}
      userId="admin-1"
      providerOrganisation={providerOrganisation}
      canManageOrganisation
      onOrganisationUpdated={onOrganisationUpdated}
      onClose={vi.fn()}
    />
  )

  fireEvent.click(screen.getByRole('button', { name: /Organisation settings/ }))
  expect(screen.getByRole('dialog', { name: 'Organisation settings' })).toHaveAttribute('data-learner-name', 'Acme')
  fireEvent.click(screen.getByRole('button', { name: 'Back from organisation settings' }))
  expect(onOrganisationUpdated).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible()
})
