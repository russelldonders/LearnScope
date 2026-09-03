import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LinkInvitationSuccess from './LinkInvitationSuccess'
import { FIXTURE_ACTIVE_INVITATION } from './accountLinkingFixtures'

afterEach(cleanup)

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('LinkInvitationSuccess', () => {
  it('shows the invited email, the copyable link, and its expiry', () => {
    render(<LinkInvitationSuccess invitation={FIXTURE_ACTIVE_INVITATION} />)
    // The invited email is mentioned twice (share-with line, sign-out
    // instructions) -- both are expected, so assert on the count rather
    // than a single ambiguous match.
    expect(screen.getAllByText(FIXTURE_ACTIVE_INVITATION.invitedEmail)).toHaveLength(2)
    expect(screen.getByLabelText('One-time link')).toHaveValue(FIXTURE_ACTIVE_INVITATION.url)
    expect(screen.getByText(/expires/)).toBeInTheDocument()
  })

  it('instructs the invited account to sign out and open the link while authenticated as themselves', () => {
    render(<LinkInvitationSuccess invitation={FIXTURE_ACTIVE_INVITATION} />)
    const instructions = screen.getByText(/needs to sign out/)
    expect(instructions).toHaveTextContent('sign out')
    expect(instructions).toHaveTextContent('open this link while signed in as that account')
  })

  it('states that verifying does not merge profiles or auto-share information', () => {
    render(<LinkInvitationSuccess invitation={FIXTURE_ACTIVE_INVITATION} />)
    expect(screen.getByText(/won't merge either account's profile/)).toBeInTheDocument()
  })

  it('copies the link to the clipboard and shows transient confirmation', async () => {
    render(<LinkInvitationSuccess invitation={FIXTURE_ACTIVE_INVITATION} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(FIXTURE_ACTIVE_INVITATION.url)
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument()
  })

  it('only shows "Create another invitation" when onDismiss is provided', () => {
    const { rerender } = render(<LinkInvitationSuccess invitation={FIXTURE_ACTIVE_INVITATION} />)
    expect(screen.queryByRole('button', { name: 'Create another invitation' })).not.toBeInTheDocument()
    const onDismiss = vi.fn()
    rerender(<LinkInvitationSuccess invitation={FIXTURE_ACTIVE_INVITATION} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create another invitation' }))
    expect(onDismiss).toHaveBeenCalledWith()
  })
})
