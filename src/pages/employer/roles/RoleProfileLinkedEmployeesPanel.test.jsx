import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoleProfileLinkedEmployeesPanel from './RoleProfileLinkedEmployeesPanel'
import { FIXTURE_LINKED_EMPLOYEES, FIXTURE_MEMBERS } from './roleProfileFixtures'

afterEach(cleanup)

describe('RoleProfileLinkedEmployeesPanel', () => {
  it('lists each assignment with its status', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={FIXTURE_LINKED_EMPLOYEES} />)
    expect(screen.getByText('Priya Natarajan')).toBeInTheDocument()
    expect(screen.getByText(/priya@acme.example/)).toHaveTextContent('Linked')
    expect(screen.getByText(/owen@acme.example/)).toHaveTextContent('Awaiting response')
  })

  it('shows an empty state when no employees are assigned', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={[]} />)
    expect(screen.getByText('No employees assigned to this role profile yet.')).toBeInTheDocument()
  })

  it('calls onAssignEmployees with every checked member and clears the selection', () => {
    const onAssignEmployees = vi.fn()
    render(<RoleProfileLinkedEmployeesPanel employees={[]} members={FIXTURE_MEMBERS} onAssignEmployees={onAssignEmployees} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /priya@acme.example/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /new.hire@acme.example/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Assign 2 selected' }))
    expect(onAssignEmployees).toHaveBeenCalledWith(expect.arrayContaining(['member-1', 'member-3']))
    expect(onAssignEmployees.mock.calls[0][0]).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
  })

  it('excludes an already-linked member from the picker', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={FIXTURE_LINKED_EMPLOYEES} members={FIXTURE_MEMBERS} />)
    expect(screen.queryByRole('checkbox', { name: /priya@acme.example/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /new.hire@acme.example/ })).toBeInTheDocument()
  })

  it('disables Assign with nothing selected', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={[]} members={FIXTURE_MEMBERS} />)
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
  })

  it('calls onWithdrawAssignment with the right assignmentId', () => {
    const onWithdrawAssignment = vi.fn()
    render(<RoleProfileLinkedEmployeesPanel employees={FIXTURE_LINKED_EMPLOYEES} onWithdrawAssignment={onWithdrawAssignment} />)
    const priyaRow = screen.getByText('Priya Natarajan').closest('li')
    fireEvent.click(priyaRow.querySelector('button'))
    expect(onWithdrawAssignment).toHaveBeenCalledWith('assignment-1')
  })

  it('disables assigning and withdrawing while a request is in flight', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={FIXTURE_LINKED_EMPLOYEES} members={FIXTURE_MEMBERS} assigning />)
    expect(screen.getByLabelText('Add employees')).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Withdraw' })[0]).toBeDisabled()
  })

  it('renders an inline error', () => {
    render(<RoleProfileLinkedEmployeesPanel employees={[]} error="Couldn't assign that employee." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't assign that employee.")
  })

  it('summarizes readiness for a linked employee against required skills and training', () => {
    render(
      <RoleProfileLinkedEmployeesPanel
        employees={FIXTURE_LINKED_EMPLOYEES}
        requiredSkills={[{ skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 }, { skillId: 'skill-2', name: 'Incident response', targetLevel: 4 }]}
        training={[{ courseId: 'course-1', title: 'De-escalation fundamentals' }]}
        readiness={{ 'user-1': { skills: { 'skill-1': 3, 'skill-2': 2 }, training: { 'course-1': 'enrolled' } } }}
      />
    )
    expect(screen.getByText('1/2 skills met · 1/1 training started')).toBeInTheDocument()
    fireEvent.click(screen.getByText('1/2 skills met · 1/1 training started'))
    expect(screen.getByText('Meets target (3)')).toBeInTheDocument()
    expect(screen.getByText('Below target (2 of 4)')).toBeInTheDocument()
    expect(screen.getByText('Started')).toBeInTheDocument()
  })

  it('shows unshared skills and unassigned training distinctly from a pending employee with no readiness at all', () => {
    render(
      <RoleProfileLinkedEmployeesPanel
        employees={FIXTURE_LINKED_EMPLOYEES}
        requiredSkills={[{ skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 }]}
        training={[{ courseId: 'course-1', title: 'De-escalation fundamentals' }]}
        readiness={{}}
      />
    )
    // Only the accepted employee (Priya) gets a readiness summary -- the
    // pending one (Owen) hasn't linked their experience yet, so there's
    // nothing to evaluate against.
    expect(screen.getByText('0/1 skills met · 0/1 training started')).toBeInTheDocument()
    fireEvent.click(screen.getByText('0/1 skills met · 0/1 training started'))
    expect(screen.getByText('Not shared')).toBeInTheDocument()
    expect(screen.getByText('Not assigned')).toBeInTheDocument()
  })
})
