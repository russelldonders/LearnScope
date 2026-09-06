import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerRoleProfilesConsole from './EmployerRoleProfilesConsole'
import { FIXTURE_ROLE_PROFILES } from './roleProfileFixtures'

afterEach(cleanup)

function renderConsole(props = {}) {
  return render(<EmployerRoleProfilesConsole roleProfiles={FIXTURE_ROLE_PROFILES} {...props} />)
}

function getRow(name) {
  return screen.getByText(name).closest('tr')
}

describe('EmployerRoleProfilesConsole (controlled)', () => {
  it('calls onOpenProfile with that row\'s own id when its name is clicked', () => {
    const onOpenProfile = vi.fn()
    renderConsole({ onOpenProfile })
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Senior Support Engineer' }))
    expect(onOpenProfile).toHaveBeenCalledWith('role-profile-1')
  })

  it('opens the create dialog when "New role profile" is clicked', () => {
    renderConsole()
    fireEvent.click(screen.getByRole('button', { name: 'New role profile' }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('creating a role profile calls onCreateRoleProfile with the entered values', async () => {
    const onCreateRoleProfile = vi.fn().mockResolvedValue('new-profile-id')
    renderConsole({ onCreateRoleProfile })
    fireEvent.click(screen.getByRole('button', { name: 'New role profile' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Onboarding Specialist' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Guides new hires.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onCreateRoleProfile).toHaveBeenCalledWith({ name: 'Onboarding Specialist', description: 'Guides new hires.' }))
  })

  it('navigates to the new profile once creation resolves with an id', async () => {
    const onOpenProfile = vi.fn()
    const onCreateRoleProfile = vi.fn().mockResolvedValue('new-profile-id')
    renderConsole({ onCreateRoleProfile, onOpenProfile })
    fireEvent.click(screen.getByRole('button', { name: 'New role profile' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Onboarding Specialist' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onOpenProfile).toHaveBeenCalledWith('new-profile-id'))
  })

  it('renders an inline error', () => {
    renderConsole({ error: "Couldn't load role profiles." })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load role profiles.")
  })
})
