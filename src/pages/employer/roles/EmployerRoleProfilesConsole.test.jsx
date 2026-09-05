import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmployerRoleProfilesConsole from './EmployerRoleProfilesConsole'
import {
  FIXTURE_COURSE_CATALOGUE,
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
      {...props}
    />
  )
}

function getRow(name) {
  return screen.getByText(name).closest('tr')
}

describe('EmployerRoleProfilesConsole (controlled)', () => {
  it('opens the edit dialog pre-filled with that row\'s own name/description', () => {
    renderConsole()
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Senior Support Engineer')
    expect(screen.getByLabelText('Description')).toHaveValue(FIXTURE_ROLE_PROFILES[0].description)
  })

  it('opening "Assign skills" on a different row shows that row\'s own required skills, not another row\'s', () => {
    renderConsole()
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Assign skills' }))
    expect(screen.getByText('Required skills')).toBeInTheDocument()
    expect(screen.getByText('Facilitation')).toBeInTheDocument()
  })

  it('creating a role profile calls onSaveRoleProfile with a null id', () => {
    const onSaveRoleProfile = vi.fn()
    renderConsole({ onSaveRoleProfile })
    fireEvent.click(screen.getByRole('button', { name: 'New role profile' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Onboarding Specialist' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Guides new hires.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaveRoleProfile).toHaveBeenCalledWith(null, { name: 'Onboarding Specialist', description: 'Guides new hires.' })
  })

  it('editing an existing role profile calls onSaveRoleProfile with its id', () => {
    const onSaveRoleProfile = vi.fn()
    renderConsole({ onSaveRoleProfile })
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Senior Support Engineer II' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSaveRoleProfile).toHaveBeenCalledWith('role-profile-1', {
      name: 'Senior Support Engineer II',
      description: FIXTURE_ROLE_PROFILES[0].description,
    })
  })

  it('adding a required skill calls onReplaceSkills with the full next array, not a mutation', () => {
    const onReplaceSkills = vi.fn()
    renderConsole({ onReplaceSkills })
    fireEvent.click(within(getRow('Field Operations Lead')).getByRole('button', { name: 'Assign skills' }))
    fireEvent.change(screen.getByLabelText('Add a skill'), { target: { value: 'skill-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onReplaceSkills).toHaveBeenCalledWith('role-profile-2', [
      { skillId: 'skill-3', name: 'Data storytelling', targetLevel: 3 },
    ])
    // Field Operations Lead's fixture required-skills list is untouched.
    expect(FIXTURE_ROLE_PROFILES[1].requiredSkills).toEqual([])
  })

  it('removing a required skill calls onReplaceSkills with that skill filtered out', () => {
    const onReplaceSkills = vi.fn()
    renderConsole({ onReplaceSkills })
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Assign skills' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(onReplaceSkills).toHaveBeenCalledWith(
      'role-profile-1',
      FIXTURE_ROLE_PROFILES[0].requiredSkills.slice(1)
    )
  })

  it('adding training calls onReplaceTraining keyed by courseId, not a synthetic id', () => {
    const onReplaceTraining = vi.fn()
    renderConsole({ onReplaceTraining })
    fireEvent.click(within(getRow('Field Operations Lead')).getByRole('button', { name: 'Assign training' }))
    fireEvent.change(screen.getByLabelText('Add training'), { target: { value: 'course-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onReplaceTraining).toHaveBeenCalledWith('role-profile-2', [
      { courseId: 'course-3', title: 'Leading through change', requirement: 'required' },
    ])
  })

  it('assigning an employee calls onAssignEmployee with that row\'s profile id and email', () => {
    const onAssignEmployee = vi.fn()
    renderConsole({ onAssignEmployee })
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Assign users' }))
    fireEvent.change(screen.getByLabelText('Assign by email'), { target: { value: 'new.hire@acme.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    expect(onAssignEmployee).toHaveBeenCalledWith('role-profile-1', 'new.hire@acme.example')
  })

  it('withdrawing an assignment calls onWithdrawAssignment with the assignmentId', () => {
    const onWithdrawAssignment = vi.fn()
    renderConsole({ onWithdrawAssignment })
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Assign users' }))
    const row = screen.getByText('Priya Natarajan').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Withdraw' }))
    expect(onWithdrawAssignment).toHaveBeenCalledWith('assignment-1')
  })

  it('shows a single error banner inside whichever dialog is open, not a duplicate outer one', () => {
    renderConsole({ error: "Couldn't save that change." })
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Assign skills' }))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save that change.")
  })

  it('disables mutation controls while loading', () => {
    renderConsole({ loading: true })
    fireEvent.click(within(getRow('Senior Support Engineer')).getByRole('button', { name: 'Assign users' }))
    expect(screen.getByRole('button', { name: 'Assigning…' })).toBeDisabled()
    expect(screen.getByLabelText('Assign by email')).toBeDisabled()
  })
})
