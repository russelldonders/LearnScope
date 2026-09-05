import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileList from './RoleProfileList'
import { FIXTURE_ROLE_PROFILES } from './roleProfileFixtures'

afterEach(cleanup)

function getRow(name) {
  return screen.getByText(name).closest('tr')
}

describe('RoleProfileList', () => {
  it('lists each role profile with its skill/training/linked-employee counts', () => {
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} />)
    const cells = getRow('Senior Support Engineer').querySelectorAll('td')
    // Name, description, skills, training, employees, updated, actions
    expect(cells[2]).toHaveTextContent('3')
    expect(cells[3]).toHaveTextContent('2')
    expect(cells[4]).toHaveTextContent('2')
  })

  it('calls onEdit with the role profile id', () => {
    const onEdit = vi.fn()
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} onEdit={onEdit} />)
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledWith('role-profile-1')
  })

  it('calls onAssignSkills with the role profile id', () => {
    const onAssignSkills = vi.fn()
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} onAssignSkills={onAssignSkills} />)
    fireEvent.click(within(getRow('Field Operations Lead')).getByRole('button', { name: 'Assign skills' }))
    expect(onAssignSkills).toHaveBeenCalledWith('role-profile-2')
  })

  it('calls onAssignTraining with the role profile id', () => {
    const onAssignTraining = vi.fn()
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} onAssignTraining={onAssignTraining} />)
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Assign training' }))
    expect(onAssignTraining).toHaveBeenCalledWith('role-profile-1')
  })

  it('calls onAssignUsers with the role profile id', () => {
    const onAssignUsers = vi.fn()
    render(<RoleProfileList roleProfiles={FIXTURE_ROLE_PROFILES} onAssignUsers={onAssignUsers} />)
    fireEvent.click(within(getRow('Field Operations Lead')).getByRole('button', { name: 'Assign users' }))
    expect(onAssignUsers).toHaveBeenCalledWith('role-profile-2')
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

  it('shows a no-match state when a search matches nothing, distinct from the empty roster', () => {
    render(<RoleProfileList roleProfiles={[]} hasAnyRoleProfiles query="nomatch" filtersActive />)
    expect(screen.getByText(/No role profiles match your search/)).toBeInTheDocument()
    expect(screen.queryByText(/No role profiles yet/)).not.toBeInTheDocument()
  })

  it('renders an inline error', () => {
    render(<RoleProfileList roleProfiles={[]} error="Couldn't load role profiles." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load role profiles.")
  })
})
