import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerRoleProfilesConsole from './EmployerRoleProfilesConsole'
import {
  FIXTURE_COURSE_CATALOGUE,
  FIXTURE_LINKED_EMPLOYEES,
  FIXTURE_ROLE_PROFILES,
  FIXTURE_SKILL_CATALOGUE,
} from './roleProfileFixtures'

afterEach(cleanup)

function renderConsole(props = {}) {
  return render(
    <EmployerRoleProfilesConsole
      roleProfiles={FIXTURE_ROLE_PROFILES}
      availableSkills={FIXTURE_SKILL_CATALOGUE}
      availableCourses={FIXTURE_COURSE_CATALOGUE}
      linkedEmployees={FIXTURE_LINKED_EMPLOYEES}
      {...props}
    />
  )
}

describe('EmployerRoleProfilesConsole (controlled)', () => {
  it('clicking a role profile calls onSelectRoleProfile instead of self-selecting', () => {
    const onSelectRoleProfile = vi.fn()
    renderConsole({ onSelectRoleProfile })
    fireEvent.click(screen.getByText('Senior Support Engineer'))
    expect(onSelectRoleProfile).toHaveBeenCalledWith('role-profile-1')
    // Nothing renders as selected until the caller feeds selectedRoleProfileId back down.
    expect(screen.queryByText('Required skills')).not.toBeInTheDocument()
  })

  it('renders the selected profile\'s skills/training/linked employees purely from props', () => {
    renderConsole({ selectedRoleProfileId: 'role-profile-1' })
    expect(screen.getByText('Required skills')).toBeInTheDocument()
    expect(screen.getByText('Facilitation')).toBeInTheDocument()
    expect(screen.getByText('De-escalation fundamentals')).toBeInTheDocument()
    expect(screen.getByText('Priya Natarajan')).toBeInTheDocument()
  })

  it('creating a role profile calls onSaveRoleProfile with a null id', () => {
    const onSaveRoleProfile = vi.fn()
    renderConsole({ onSaveRoleProfile })
    fireEvent.click(screen.getByRole('button', { name: 'New role profile' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Onboarding Specialist' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Guides new hires.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaveRoleProfile).toHaveBeenCalledWith(null, { name: 'Onboarding Specialist', description: 'Guides new hires.' })
    // No new profile appears in the list -- the console never fabricates one itself.
    expect(screen.queryByText('Onboarding Specialist')).not.toBeInTheDocument()
  })

  it('editing an existing role profile calls onSaveRoleProfile with its id', () => {
    const onSaveRoleProfile = vi.fn()
    renderConsole({ selectedRoleProfileId: 'role-profile-1', onSaveRoleProfile })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Senior Support Engineer II' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaveRoleProfile).toHaveBeenCalledWith('role-profile-1', {
      name: 'Senior Support Engineer II',
      description: FIXTURE_ROLE_PROFILES[0].description,
    })
  })

  it('adding a required skill calls onReplaceSkills with the full next array, not a mutation', () => {
    const onReplaceSkills = vi.fn()
    renderConsole({ selectedRoleProfileId: 'role-profile-2', onReplaceSkills })
    const skillsPanel = screen.getByText('Required skills').closest('div')
    fireEvent.change(within(skillsPanel).getByLabelText('Add a skill'), { target: { value: 'skill-3' } })
    fireEvent.click(within(skillsPanel).getByRole('button', { name: 'Add' }))
    expect(onReplaceSkills).toHaveBeenCalledWith('role-profile-2', [
      { skillId: 'skill-3', name: 'Data storytelling', targetLevel: 3 },
    ])
    // Field Operations Lead's fixture required-skills list is untouched.
    expect(FIXTURE_ROLE_PROFILES[1].requiredSkills).toEqual([])
  })

  it('removing a required skill calls onReplaceSkills with that skill filtered out', () => {
    const onReplaceSkills = vi.fn()
    renderConsole({ selectedRoleProfileId: 'role-profile-1', onReplaceSkills })
    const skillsPanel = screen.getByText('Required skills').closest('div')
    fireEvent.click(within(skillsPanel).getAllByRole('button', { name: 'Remove' })[0])
    expect(onReplaceSkills).toHaveBeenCalledWith(
      'role-profile-1',
      FIXTURE_ROLE_PROFILES[0].requiredSkills.slice(1)
    )
  })

  it('adding training calls onReplaceTraining keyed by courseId, not a synthetic id', () => {
    const onReplaceTraining = vi.fn()
    renderConsole({ selectedRoleProfileId: 'role-profile-2', onReplaceTraining })
    const trainingPanel = screen.getByText('Training').closest('div')
    fireEvent.change(within(trainingPanel).getByLabelText('Add training'), { target: { value: 'course-3' } })
    fireEvent.click(within(trainingPanel).getByRole('button', { name: 'Add' }))
    expect(onReplaceTraining).toHaveBeenCalledWith('role-profile-2', [
      { courseId: 'course-3', title: 'Leading through change', requirement: 'required' },
    ])
  })

  it('assigning an employee calls onAssignEmployee with the selected profile id and email', () => {
    const onAssignEmployee = vi.fn()
    renderConsole({ selectedRoleProfileId: 'role-profile-1', onAssignEmployee })
    fireEvent.change(screen.getByLabelText('Assign by email'), { target: { value: 'new.hire@acme.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    expect(onAssignEmployee).toHaveBeenCalledWith('role-profile-1', 'new.hire@acme.example')
  })

  it('withdrawing an assignment calls onWithdrawAssignment with the assignmentId', () => {
    const onWithdrawAssignment = vi.fn()
    renderConsole({ selectedRoleProfileId: 'role-profile-1', onWithdrawAssignment })
    const row = screen.getByText('Priya Natarajan').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Withdraw' }))
    expect(onWithdrawAssignment).toHaveBeenCalledWith('assignment-1')
  })

  it('shows a single shared error banner rather than repeating it per panel', () => {
    renderConsole({ selectedRoleProfileId: 'role-profile-1', error: "Couldn't save that change." })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save that change.")
  })

  it('disables mutation controls while loading', () => {
    renderConsole({ selectedRoleProfileId: 'role-profile-1', loading: true })
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByLabelText('Assign by email')).toBeDisabled()
  })
})
