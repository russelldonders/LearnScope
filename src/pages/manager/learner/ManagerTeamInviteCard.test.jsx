import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManagerTeamInviteCard from './ManagerTeamInviteCard'
import { FIXTURE_INVITE } from './managerLearnerFixtures'

afterEach(cleanup)

describe('ManagerTeamInviteCard', () => {
  it('explains that accepting does not expose the complete profile', () => {
    render(<ManagerTeamInviteCard invite={FIXTURE_INVITE} />)
    expect(screen.getByText(/does not give/i)).toHaveTextContent('complete profile')
  })

  it('calls onAccept / onDecline with no arguments', () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    render(<ManagerTeamInviteCard invite={FIXTURE_INVITE} onAccept={onAccept} onDecline={onDecline} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))

    expect(onAccept).toHaveBeenCalledWith()
    expect(onDecline).toHaveBeenCalledWith()
  })

  it('disables both actions while submitting', () => {
    render(<ManagerTeamInviteCard invite={FIXTURE_INVITE} submitting />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  })

  it('renders an inline error', () => {
    render(<ManagerTeamInviteCard invite={FIXTURE_INVITE} error="Couldn't respond -- try again." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't respond -- try again.")
  })
})
