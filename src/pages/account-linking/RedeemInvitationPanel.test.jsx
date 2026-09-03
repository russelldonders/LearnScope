import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RedeemInvitationPanel from './RedeemInvitationPanel'
import { FIXTURE_INVITATION_PREVIEW, FIXTURE_REDEEM_TOKEN } from './accountLinkingFixtures'

afterEach(cleanup)

describe('RedeemInvitationPanel', () => {
  it('shows an invalid-link state when no token is supplied', () => {
    render(<RedeemInvitationPanel token={null} />)
    expect(screen.getByText(/missing or incomplete/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the inviter when a preview is available', () => {
    render(<RedeemInvitationPanel token={FIXTURE_REDEEM_TOKEN} invitationPreview={FIXTURE_INVITATION_PREVIEW} />)
    expect(screen.getByText(/russell@example.com wants to verify/)).toBeInTheDocument()
  })

  it('falls back to generic copy with no preview', () => {
    render(<RedeemInvitationPanel token={FIXTURE_REDEEM_TOKEN} />)
    expect(screen.getByText(/about to verify a link/)).toBeInTheDocument()
  })

  it('states that confirming does not merge profiles or auto-share information', () => {
    render(<RedeemInvitationPanel token={FIXTURE_REDEEM_TOKEN} />)
    expect(screen.getByText(/won't merge either account's profile/)).toBeInTheDocument()
  })

  it('calls onRedeem with the token', () => {
    const onRedeem = vi.fn()
    render(<RedeemInvitationPanel token={FIXTURE_REDEEM_TOKEN} onRedeem={onRedeem} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm this is my account' }))
    expect(onRedeem).toHaveBeenCalledWith(FIXTURE_REDEEM_TOKEN)
  })

  it('disables the confirm button and shows pending text while redeeming', () => {
    render(<RedeemInvitationPanel token={FIXTURE_REDEEM_TOKEN} redeeming />)
    expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled()
  })

  it('shows a success state, with no confirm button, once redeemed', () => {
    render(<RedeemInvitationPanel token={FIXTURE_REDEEM_TOKEN} redeemed />)
    expect(screen.getByText('Accounts verified')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders an inline error', () => {
    render(<RedeemInvitationPanel token={FIXTURE_REDEEM_TOKEN} error="This link has expired." />)
    expect(screen.getByRole('alert')).toHaveTextContent('This link has expired.')
  })
})
