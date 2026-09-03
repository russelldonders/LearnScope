import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LearnerRoleAlignmentSection from './LearnerRoleAlignmentSection'
import {
  FIXTURE_ALIGNMENT_BY_ASSIGNMENT_ID,
  FIXTURE_CURRENT_ROLES,
  FIXTURE_LINKED_ASSIGNMENTS,
  FIXTURE_PENDING_ASSIGNMENTS,
} from './roleAlignmentFixtures'

afterEach(cleanup)

function renderSection(props = {}) {
  return render(
    <LearnerRoleAlignmentSection
      currentRoles={FIXTURE_CURRENT_ROLES}
      pendingAssignments={FIXTURE_PENDING_ASSIGNMENTS}
      linkedAssignments={FIXTURE_LINKED_ASSIGNMENTS}
      alignmentByAssignmentId={FIXTURE_ALIGNMENT_BY_ASSIGNMENT_ID}
      {...props}
    />
  )
}

describe('LearnerRoleAlignmentSection (controlled)', () => {
  it('always shows the current role, plus whatever pending/linked assignments are passed in', () => {
    renderSection()
    expect(screen.getByText('Your current role')).toBeInTheDocument()
    expect(screen.getByText('Aligned (1)')).toBeInTheDocument()
    expect(screen.getByText('Gaps (2)')).toBeInTheDocument()
    expect(screen.getByText(/Field Operations Lead/)).toBeInTheDocument()
  })

  it('accepting a pending assignment calls onAcceptAssignment with the current role id, and does not fabricate a new linked assignment locally', () => {
    const onAcceptAssignment = vi.fn()
    renderSection({ onAcceptAssignment })
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAcceptAssignment).toHaveBeenCalledWith('assignment-2', 'experience-1')
    // Nothing changes on screen -- the caller must feed the updated
    // pendingAssignments/linkedAssignments back down for anything to move.
    expect(screen.getByText(/Field Operations Lead/)).toBeInTheDocument()
    expect(screen.getByText('Aligned (1)')).toBeInTheDocument()
  })

  it('declining a pending assignment calls onDeclineAssignment with its id', () => {
    const onDeclineAssignment = vi.fn()
    renderSection({ onDeclineAssignment })
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDeclineAssignment).toHaveBeenCalledWith('assignment-2')
  })

  it('disconnecting a linked assignment calls onDisconnectAssignment with its id, and never touches the current role', () => {
    const onDisconnectAssignment = vi.fn()
    renderSection({ onDisconnectAssignment })
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    const confirmButtons = screen.getAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(onDisconnectAssignment).toHaveBeenCalledWith('assignment-1')
    // The current role card is untouched by the disconnect.
    expect(screen.getByText('Your current role').closest('div')).toHaveTextContent(
      FIXTURE_CURRENT_ROLES[0].organization
    )
  })

  it('rendering with no linked assignments shows no alignment summary, only pending assignments', () => {
    renderSection({ linkedAssignments: [] })
    expect(screen.queryByText(/Aligned \(/)).not.toBeInTheDocument()
    expect(screen.queryByText('Disconnect')).not.toBeInTheDocument()
    expect(screen.getByText(/Field Operations Lead/)).toBeInTheDocument()
  })

  it('shows a single shared error banner rather than repeating it per assignment', () => {
    renderSection({ error: "Couldn't respond -- try again." })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})
