import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmployerCatalogueAccessPanel from './EmployerCatalogueAccessPanel'

const listAccessMock = vi.hoisted(() => vi.fn())
const saveAccessMock = vi.hoisted(() => vi.fn())
const listRolesMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/employerCatalogues', () => ({
  EMPLOYER_CATALOGUE_VISIBILITY: [
    { value: 'public', label: 'Public and members', description: 'Public description' },
    { value: 'all_members', label: 'All members', description: 'Member description' },
    { value: 'role_profiles', label: 'Selected role profiles', description: 'Role description' },
    { value: 'hidden', label: 'Hidden', description: 'Hidden description' },
  ],
  listEmployerCatalogueAccess: listAccessMock,
  setEmployerCatalogueAccess: saveAccessMock,
}))
vi.mock('../../lib/employerRoleProfiles', () => ({ listEmployerRoleProfiles: listRolesMock }))

beforeEach(() => {
  listAccessMock.mockResolvedValue([{
    catalogueId: 'catalogue-1',
    name: 'Leadership',
    description: 'Development for leaders',
    providerName: 'Learning Co',
    visibility: 'hidden',
    roleProfileIds: [],
  }])
  listRolesMock.mockResolvedValue([{ id: 'role-1', name: 'Supervisor', status: 'active' }])
  saveAccessMock.mockResolvedValue()
})

afterEach(cleanup)

describe('EmployerCatalogueAccessPanel', () => {
  it('explains that public access also includes signed-in members', async () => {
    render(<EmployerCatalogueAccessPanel employerId="employer-1" />)

    expect(await screen.findByText('Leadership')).toBeInTheDocument()
    expect(screen.getByText(/visitors see them before login and active members also see them/i)).toBeInTheDocument()
  })

  it('requires and saves a role profile for restricted access', async () => {
    render(<EmployerCatalogueAccessPanel employerId="employer-1" />)
    const select = await screen.findByLabelText('Access for Leadership')

    fireEvent.change(select, { target: { value: 'role_profiles' } })
    expect(screen.getByText('Select at least one role profile.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.click(screen.getByText('Supervisor'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveAccessMock).toHaveBeenCalledWith(
      'employer-1', 'catalogue-1', 'role_profiles', ['role-1']
    ))
  })
})
