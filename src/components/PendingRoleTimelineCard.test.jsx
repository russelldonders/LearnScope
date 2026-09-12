import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PendingRoleTimelineCard from './PendingRoleTimelineCard'

afterEach(cleanup)

const assignment = {
  assignmentId: 'assignment-2',
  employerName: 'Acme Corp',
  roleProfile: { name: 'Field Operations Lead', description: 'Coordinates on-site teams.' },
  proposedAt: '2026-08-20',
}

describe('PendingRoleTimelineCard', () => {
  it('shows the proposing employer and role profile', () => {
    render(<PendingRoleTimelineCard assignment={assignment} />)
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument()
    expect(screen.getByText('Field Operations Lead')).toBeInTheDocument()
  })

  it('calls onAccept with the assignmentId', () => {
    const onAccept = vi.fn()
    render(<PendingRoleTimelineCard assignment={assignment} onAccept={onAccept} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledWith('assignment-2')
  })

  it('calls onDecline with the assignmentId', () => {
    const onDecline = vi.fn()
    render(<PendingRoleTimelineCard assignment={assignment} onDecline={onDecline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDecline).toHaveBeenCalledWith('assignment-2')
  })

  it('disables both actions while responding', () => {
    render(<PendingRoleTimelineCard assignment={assignment} responding />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  })
})
