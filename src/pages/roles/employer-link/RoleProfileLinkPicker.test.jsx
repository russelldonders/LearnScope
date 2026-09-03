import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileLinkPicker from './RoleProfileLinkPicker'
import { FIXTURE_LINKABLE_ROLE_PROFILES } from './roleAlignmentFixtures'

afterEach(cleanup)

describe('RoleProfileLinkPicker', () => {
  it('lists each linkable role profile', () => {
    render(<RoleProfileLinkPicker linkableRoleProfiles={FIXTURE_LINKABLE_ROLE_PROFILES} />)
    expect(screen.getByText('Senior Support Engineer')).toBeInTheDocument()
    expect(screen.getByText('Field Operations Lead')).toBeInTheDocument()
  })

  it('explains that linking does not replace or hand over the current role', () => {
    render(<RoleProfileLinkPicker linkableRoleProfiles={FIXTURE_LINKABLE_ROLE_PROFILES} />)
    expect(screen.getByText(/doesn't replace or/)).toHaveTextContent('hand over your current role')
  })

  it('calls onLink with the chosen role profile id', () => {
    const onLink = vi.fn()
    render(<RoleProfileLinkPicker linkableRoleProfiles={FIXTURE_LINKABLE_ROLE_PROFILES} onLink={onLink} />)
    fireEvent.click(screen.getByRole('radio', { name: /Field Operations Lead/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Link role profile' }))
    expect(onLink).toHaveBeenCalledWith('role-profile-2')
  })

  it('disables the submit button until a profile is chosen', () => {
    render(<RoleProfileLinkPicker linkableRoleProfiles={FIXTURE_LINKABLE_ROLE_PROFILES} />)
    expect(screen.getByRole('button', { name: 'Link role profile' })).toBeDisabled()
  })

  it('shows an empty state when the employer has no role profiles to offer', () => {
    render(<RoleProfileLinkPicker linkableRoleProfiles={[]} />)
    expect(screen.getByText(/hasn't published any role profiles yet/)).toBeInTheDocument()
  })

  it('disables the radios and button while linking', () => {
    render(<RoleProfileLinkPicker linkableRoleProfiles={FIXTURE_LINKABLE_ROLE_PROFILES} linking />)
    expect(screen.getByRole('radio', { name: /Senior Support Engineer/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Linking…' })).toBeDisabled()
  })

  it('renders an inline error', () => {
    render(<RoleProfileLinkPicker linkableRoleProfiles={FIXTURE_LINKABLE_ROLE_PROFILES} error="Couldn't link that role profile." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't link that role profile.")
  })
})
