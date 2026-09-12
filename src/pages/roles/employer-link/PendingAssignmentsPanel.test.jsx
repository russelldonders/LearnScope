import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PendingAssignmentsPanel from './PendingAssignmentsPanel'
import { FIXTURE_CURRENT_ROLES, FIXTURE_PENDING_ASSIGNMENTS } from './roleAlignmentFixtures'

afterEach(cleanup)

describe('PendingAssignmentsPanel', () => {
  it('shows the proposing employer and role profile', () => {
    render(<PendingAssignmentsPanel pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS} />)
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument()
    expect(screen.getByText('Field Operations Lead')).toBeInTheDocument()
  })

  it('shows an empty state when there are no pending assignments', () => {
    render(<PendingAssignmentsPanel pendingAssignments={[]} />)
    expect(screen.getByText('No role assignments from your employer right now.')).toBeInTheDocument()
  })

  it('with no current role, accepting calls onAcceptAssignment with no target -- no picker shown', () => {
    const onAcceptAssignment = vi.fn()
    render(<PendingAssignmentsPanel pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS} onAcceptAssignment={onAcceptAssignment} />)
    expect(screen.queryByLabelText('Link to')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAcceptAssignment).toHaveBeenCalledWith('assignment-2', undefined)
  })

  it('with a current role available, defaults to creating a new one but lets the learner pick it instead', () => {
    const onAcceptAssignment = vi.fn()
    render(
      <PendingAssignmentsPanel
        pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS}
        currentRoles={FIXTURE_CURRENT_ROLES}
        onAcceptAssignment={onAcceptAssignment}
      />
    )
    // Not required to choose -- Accept already works before touching the picker.
    expect(screen.getByRole('button', { name: 'Accept' })).not.toBeDisabled()
    fireEvent.change(screen.getByLabelText('Link to'), { target: { value: 'experience-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAcceptAssignment).toHaveBeenCalledWith('assignment-2', 'experience-1')
  })

  it('calls onDeclineAssignment with the assignmentId', () => {
    const onDeclineAssignment = vi.fn()
    render(<PendingAssignmentsPanel pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS} onDeclineAssignment={onDeclineAssignment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDeclineAssignment).toHaveBeenCalledWith('assignment-2')
  })

  it('disables both actions while responding', () => {
    render(<PendingAssignmentsPanel pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS} responding />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  })

  it('renders an inline error', () => {
    render(<PendingAssignmentsPanel pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS} error="Couldn't respond -- try again." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't respond -- try again.")
  })
})
