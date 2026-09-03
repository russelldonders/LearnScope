import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileList from './RoleProfileList'
import { FIXTURE_ROLE_PROFILES } from './roleProfileFixtures'

afterEach(cleanup)

describe('RoleProfileList', () => {
  it('lists each role profile with its skill/training/linked-employee counts', () => {
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} />)
    expect(screen.getByText('Senior Support Engineer')).toBeInTheDocument()
    expect(screen.getByText(/3 skills · 2 training items · 2 employees linked/)).toBeInTheDocument()
  })

  it('calls onSelect with the role profile id', () => {
    const onSelect = vi.fn()
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Senior Support Engineer'))
    expect(onSelect).toHaveBeenCalledWith('role-profile-1')
  })

  it('calls onCreate when "New role profile" is clicked', () => {
    const onCreate = vi.fn()
    render(<RoleProfileList roleProfiles={[]} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: 'New role profile' }))
    expect(onCreate).toHaveBeenCalledWith()
  })

  it('shows an empty state when there are no role profiles yet', () => {
    render(<RoleProfileList roleProfiles={[]} />)
    expect(screen.getByText(/No role profiles yet/)).toBeInTheDocument()
  })

  it('marks the selected profile with aria-current', () => {
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} selectedId="role-profile-1" />)
    expect(screen.getByText('Senior Support Engineer').closest('button')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Field Operations Lead').closest('button')).not.toHaveAttribute('aria-current')
  })

  it('renders an inline error', () => {
    render(<RoleProfileList roleProfiles={[]} error="Couldn't load role profiles." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load role profiles.")
  })
})
