import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LinkedAccountsList from './LinkedAccountsList'
import { FIXTURE_LINKED_ACCOUNTS } from './accountLinkingFixtures'

afterEach(cleanup)

describe('LinkedAccountsList', () => {
  it('lists each linked account with email, type, verification date and status', () => {
    render(<LinkedAccountsList linkedAccounts={FIXTURE_LINKED_ACCOUNTS} />)
    expect(screen.getByText('me.personal@example.com')).toBeInTheDocument()
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(row).toHaveTextContent('Invited by you')
    expect(row).toHaveTextContent('verified')
    expect(row).toHaveTextContent('Verified')

    const otherRow = screen.getByText('me.work@example.com').closest('li')
    expect(otherRow).toHaveTextContent('Invited you')
  })

  it('shows an empty state when nothing is linked', () => {
    render(<LinkedAccountsList linkedAccounts={[]} />)
    expect(screen.getByText("You haven't linked any other accounts yet.")).toBeInTheDocument()
  })

  it('confirms before revoking, and calls onRevoke with the right id', () => {
    const onRevoke = vi.fn()
    render(<LinkedAccountsList linkedAccounts={FIXTURE_LINKED_ACCOUNTS} onRevoke={onRevoke} />)

    const row = screen.getByText('me.personal@example.com').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
    expect(screen.getByText(/Revoke the verified link with me.personal@example.com\?/)).toBeInTheDocument()

    const confirmButtons = screen.getAllByRole('button', { name: 'Revoke' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(onRevoke).toHaveBeenCalledWith('link-1')
  })

  it('surfaces a failed revoke attempt inline in the confirm dialog', () => {
    render(<LinkedAccountsList linkedAccounts={FIXTURE_LINKED_ACCOUNTS} error="Couldn't revoke -- try again." />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't revoke -- try again.")
  })

  it('closes the confirm dialog once revoking finishes with no error', () => {
    const { rerender } = render(<LinkedAccountsList linkedAccounts={FIXTURE_LINKED_ACCOUNTS} revokingId="link-1" />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(<LinkedAccountsList linkedAccounts={FIXTURE_LINKED_ACCOUNTS} revokingId={null} error={null} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
