import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerRoleProfilesConsole from './EmployerRoleProfilesConsole'
import { FIXTURE_ROLE_PROFILES } from './roleProfileFixtures'

vi.mock('../../../context/LanguageContext', () => import('../../../test/languageMock'))

afterEach(cleanup)

const MEMBERS = [
  { id: 'member-1', user_id: 'user-1', email: 'priya@acme.example', status: 'active' },
  { id: 'member-2', user_id: 'user-3', email: 'sam@acme.example', status: 'active' },
  { id: 'member-3', user_id: 'user-4', email: 'gone@acme.example', status: 'removed' },
]

// Stands in for the router-backed search params so the URL-synced status
// filter actually changes when the select does.
function WithSearchParams(props) {
  const [searchParams, setSearchParams] = useState(() => new URLSearchParams())
  return <EmployerRoleProfilesConsole searchParams={searchParams} setSearchParams={setSearchParams} {...props} />
}

function renderConsole(props = {}) {
  const handlers = {
    onAssignRoleProfiles: vi.fn().mockResolvedValue({ proposed: 2, skipped: 0 }),
    onSetRoleProfilesStatus: vi.fn().mockResolvedValue(),
    onDeleteRoleProfiles: vi.fn().mockResolvedValue(),
    ...props,
  }
  render(<WithSearchParams roleProfiles={FIXTURE_ROLE_PROFILES} members={MEMBERS} {...props} {...handlers} />)
  return handlers
}

function select(name) {
  fireEvent.click(screen.getByLabelText(`Select ${name}`))
}

describe('EmployerRoleProfilesConsole bulk actions', () => {
  it('shows a bulk action bar once role profiles are selected', () => {
    renderConsole()
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
    select('Senior Support Engineer')
    select('Field Operations Lead')
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('assigns the selected role profiles to the chosen active employees', async () => {
    const { onAssignRoleProfiles } = renderConsole()
    select('Senior Support Engineer')
    select('Field Operations Lead')
    fireEvent.click(screen.getByRole('button', { name: 'Assign to employees' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('gone@acme.example')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText('sam@acme.example'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to 1 employee' }))
    await waitFor(() => expect(onAssignRoleProfiles).toHaveBeenCalledWith(
      ['role-profile-1', 'role-profile-2'],
      ['member-2'],
      { startDate: null, endDate: null }
    ))
    expect(await screen.findByText('Proposed 2 role assignments.')).toBeInTheDocument()
  })

  it('deactivates selected role profiles after confirmation', async () => {
    const { onSetRoleProfilesStatus } = renderConsole()
    select('Field Operations Lead')
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(onSetRoleProfilesStatus).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(onSetRoleProfilesStatus).toHaveBeenCalledWith(['role-profile-2'], 'archived'))
  })

  it('reactivates inactive role profiles and filters by status', async () => {
    const profiles = FIXTURE_ROLE_PROFILES.map((p) => (p.id === 'role-profile-2' ? { ...p, status: 'archived' } : p))
    const { onSetRoleProfilesStatus } = renderConsole({ roleProfiles: profiles })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'archived' } })
    expect(screen.queryByText('Senior Support Engineer')).not.toBeInTheDocument()
    select('Field Operations Lead')
    expect(screen.getByRole('button', { name: 'Assign to employees' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(onSetRoleProfilesStatus).toHaveBeenCalledWith(['role-profile-2'], 'active'))
  })

  it('deletes role profiles nobody is linked to, after confirmation', async () => {
    const { onDeleteRoleProfiles } = renderConsole()
    select('Field Operations Lead')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onDeleteRoleProfiles).toHaveBeenCalledWith(['role-profile-2']))
  })

  it("won't delete role profiles that still have employees", () => {
    renderConsole()
    select('Senior Support Engineer')
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
