import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PendingAssignmentsPanel from './PendingAssignmentsPanel'
import { FIXTURE_CURRENT_ROLES, FIXTURE_PENDING_ASSIGNMENTS } from './roleAlignmentFixtures'

afterEach(cleanup)

describe('PendingAssignmentsPanel', () => {
  it('shows the proposing employer and role profile', () => {
    render(<PendingAssignmentsPanel pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS} currentRoles={FIXTURE_CURRENT_ROLES} />)
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument()
    expect(screen.getByText('Field Operations Lead')).toBeInTheDocument()
  })

  it('shows an empty state when there are no pending assignments', () => {
    render(<PendingAssignmentsPanel pendingAssignments={[]} currentRoles={FIXTURE_CURRENT_ROLES} />)
    expect(screen.getByText('No role assignments from your employer right now.')).toBeInTheDocument()
  })

  it('with exactly one current role, accepting uses it without asking the learner to choose', () => {
    const onAcceptAssignment = vi.fn()
    render(
      <PendingAssignmentsPanel
        pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS}
        currentRoles={FIXTURE_CURRENT_ROLES}
        onAcceptAssignment={onAcceptAssignment}
      />
    )
    expect(screen.queryByLabelText('Link to which current role?')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAcceptAssignment).toHaveBeenCalledWith('assignment-2', 'experience-1')
  })

  it('with more than one current role, Accept is disabled until one is explicitly chosen', () => {
    const onAcceptAssignment = vi.fn()
    const twoCurrentRoles = [
      ...FIXTURE_CURRENT_ROLES,
      { id: 'experience-2', title: 'Volunteer Coordinator', organization: 'Riverside Trust', since: '2025-01-10' },
    ]
    render(
      <PendingAssignmentsPanel
        pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS}
        currentRoles={twoCurrentRoles}
        onAcceptAssignment={onAcceptAssignment}
      />
    )
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Link to which current role?'), { target: { value: 'experience-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAcceptAssignment).toHaveBeenCalledWith('assignment-2', 'experience-2')
  })

  it('with no current role, Accept is disabled and explains why', () => {
    render(<PendingAssignmentsPanel pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS} currentRoles={[]} />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByText(/Add a current role from your Experience/)).toBeInTheDocument()
  })

  it('calls onDeclineAssignment with the assignmentId', () => {
    const onDeclineAssignment = vi.fn()
    render(
      <PendingAssignmentsPanel
        pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS}
        currentRoles={FIXTURE_CURRENT_ROLES}
        onDeclineAssignment={onDeclineAssignment}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDeclineAssignment).toHaveBeenCalledWith('assignment-2')
  })

  it('renders an inline error', () => {
    render(
      <PendingAssignmentsPanel
        pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS}
        currentRoles={FIXTURE_CURRENT_ROLES}
        error="Couldn't respond -- try again."
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't respond -- try again.")
  })
})
