import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountLinkingSection from './AccountLinkingSection'
import { FIXTURE_ACTIVE_INVITATION, FIXTURE_LINKED_ACCOUNTS } from './accountLinkingFixtures'

afterEach(cleanup)

describe('AccountLinkingSection (controlled)', () => {
  it('shows the create form when there is no active invitation', () => {
    render(<AccountLinkingSection activeInvitation={null} linkedAccounts={FIXTURE_LINKED_ACCOUNTS} />)
    expect(screen.getByText('Link another account')).toBeInTheDocument()
    expect(screen.queryByText('Invitation created')).not.toBeInTheDocument()
  })

  it('shows the success panel instead of the form when there is an active invitation', () => {
    render(<AccountLinkingSection activeInvitation={FIXTURE_ACTIVE_INVITATION} linkedAccounts={FIXTURE_LINKED_ACCOUNTS} />)
    expect(screen.getByText('Invitation created')).toBeInTheDocument()
    expect(screen.queryByText('Link another account')).not.toBeInTheDocument()
  })

  it('always shows the linked accounts list alongside either state', () => {
    render(<AccountLinkingSection activeInvitation={FIXTURE_ACTIVE_INVITATION} linkedAccounts={FIXTURE_LINKED_ACCOUNTS} />)
    const list = screen.getByText('Linked accounts').closest('div')
    expect(within(list).getByText('me.personal@example.com')).toBeInTheDocument()
  })

  it('creating an invitation calls onCreateInvitation, and does not fabricate a success state locally', () => {
    const onCreateInvitation = vi.fn()
    render(<AccountLinkingSection activeInvitation={null} linkedAccounts={[]} onCreateInvitation={onCreateInvitation} />)
    fireEvent.change(screen.getByLabelText('Email address of the other account'), {
      target: { value: 'me.work@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create link invitation' }))
    expect(onCreateInvitation).toHaveBeenCalledWith('me.work@example.com')
    // Still showing the form -- the caller must feed activeInvitation back
    // down for the success panel to appear.
    expect(screen.getByText('Link another account')).toBeInTheDocument()
  })

  it('dismissing the invitation calls onDismissInvitation', () => {
    const onDismissInvitation = vi.fn()
    render(
      <AccountLinkingSection
        activeInvitation={FIXTURE_ACTIVE_INVITATION}
        linkedAccounts={[]}
        onDismissInvitation={onDismissInvitation}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create another invitation' }))
    expect(onDismissInvitation).toHaveBeenCalledWith()
  })

  it('revoking a linked account calls onRevoke with its id', () => {
    const onRevoke = vi.fn()
    render(<AccountLinkingSection activeInvitation={null} linkedAccounts={FIXTURE_LINKED_ACCOUNTS} onRevoke={onRevoke} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    const confirmButtons = screen.getAllByRole('button', { name: 'Revoke' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(onRevoke).toHaveBeenCalledWith('link-1')
  })

  it('keeps create-form errors and revoke errors separate', () => {
    render(
      <AccountLinkingSection
        activeInvitation={null}
        linkedAccounts={FIXTURE_LINKED_ACCOUNTS}
        createError="That email already has a pending invitation."
        revokeError="Couldn't revoke -- try again."
      />
    )
    // The create-form error shows immediately.
    expect(screen.getByRole('alert')).toHaveTextContent('That email already has a pending invitation.')
    // The revoke error only appears once its own confirm dialog is open.
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toContain("Couldn't revoke -- try again.")
  })
})
