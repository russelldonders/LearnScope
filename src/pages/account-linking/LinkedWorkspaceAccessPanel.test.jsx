import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LinkedWorkspaceAccessPanel from './LinkedWorkspaceAccessPanel'
import { FIXTURE_LINKED_ACCOUNTS } from './accountLinkingFixtures'

afterEach(cleanup)

describe('LinkedWorkspaceAccessPanel', () => {
  it('renders nothing when there are no active linked accounts', () => {
    const { container } = render(<LinkedWorkspaceAccessPanel linkedAccounts={[]} requests={[]} grants={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers to share when neither a request nor a grant exists for either direction', () => {
    render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={[]} grants={[]} />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(within(row).getByRole('button', { name: 'Share your profile with them' })).toBeInTheDocument()
    expect(row).toHaveTextContent('Their profile: you cannot view it')
  })

  it('confirms before removing an outgoing grant, and calls onRevoke with the link id only after confirming', () => {
    const onRevoke = vi.fn()
    const grants = [{ linkId: 'link-1', email: 'me.personal@example.com', direction: 'granted', grantedAt: '2026-08-20T10:00:00Z' }]
    render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={[]} grants={grants} onRevoke={onRevoke} />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(row).toHaveTextContent('Your profile: they can view it, since')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove access' }))
    expect(onRevoke).not.toHaveBeenCalled()
    expect(screen.getByText(/Remove me.personal@example.com's access to your profile\?/)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^(Remove access|Give up access)$/ }))
    expect(onRevoke).toHaveBeenCalledWith('link-1')
  })

  it('shows an outgoing pending request with a cancel action, and calls onCancelRequest with the request id', () => {
    const onCancelRequest = vi.fn()
    const requests = [{ id: 'request-9', linkId: 'link-1', email: 'me.personal@example.com', direction: 'sent', status: 'pending', createdAt: '2026-09-01T10:00:00Z' }]
    render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={requests} grants={[]} onCancelRequest={onCancelRequest} />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(row).toHaveTextContent('waiting for them to accept')
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel request' }))
    expect(onCancelRequest).toHaveBeenCalledWith('request-9')
  })

  it('shows an incoming pending request with accept/decline actions', () => {
    const onAccept = vi.fn()
    const onDecline = vi.fn()
    const requests = [{ id: 'request-9', linkId: 'link-1', email: 'me.personal@example.com', direction: 'received', status: 'pending', createdAt: '2026-09-01T10:00:00Z' }]
    render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={requests} grants={[]} onAccept={onAccept} onDecline={onDecline} />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(row).toHaveTextContent('they want to share it with you')
    fireEvent.click(within(row).getByRole('button', { name: 'Accept' }))
    expect(onAccept).toHaveBeenCalledWith('request-9')
    fireEvent.click(within(row).getByRole('button', { name: 'Decline' }))
    expect(onDecline).toHaveBeenCalledWith('request-9')
  })

  it('confirms before giving up an incoming grant, and calls onRenounce with the link id only after confirming', () => {
    const onRenounce = vi.fn()
    const grants = [{ linkId: 'link-1', email: 'me.personal@example.com', direction: 'received', grantedAt: '2026-08-20T10:00:00Z' }]
    render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={[]} grants={grants} onRenounce={onRenounce} />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(row).toHaveTextContent('Their profile: you can view it, since')
    fireEvent.click(within(row).getByRole('button', { name: 'Give up access' }))
    expect(onRenounce).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^(Remove access|Give up access)$/ }))
    expect(onRenounce).toHaveBeenCalledWith('link-1')
  })

  it('shows fully bidirectional sharing (a grant in both directions at once) distinctly labelled', () => {
    const grants = [
      { linkId: 'link-1', email: 'me.personal@example.com', direction: 'granted', grantedAt: '2026-08-20T10:00:00Z' },
      { linkId: 'link-1', email: 'me.personal@example.com', direction: 'received', grantedAt: '2026-08-21T10:00:00Z' },
    ]
    render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={[]} grants={grants} />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(row).toHaveTextContent('Your profile: they can view it, since')
    expect(row).toHaveTextContent('Their profile: you can view it, since')
    expect(within(row).getByRole('button', { name: 'Remove access' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Give up access' })).toBeInTheDocument()
  })

  it('only renders active linked accounts, not revoked ones', () => {
    const linkedAccounts = [...FIXTURE_LINKED_ACCOUNTS, { id: 'link-3', email: 'revoked@example.com', direction: 'sent', verifiedAt: '2026-01-01', status: 'revoked' }]
    render(<LinkedWorkspaceAccessPanel linkedAccounts={linkedAccounts} requests={[]} grants={[]} />)
    expect(screen.queryByText('revoked@example.com')).not.toBeInTheDocument()
  })

  it('surfaces a list-load error at the top of the panel', () => {
    render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={[]} grants={[]} errors={{ load: 'Could not load sharing status.' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load sharing status.')
  })

  it('surfaces a failed request inline on that row only, not as a shared banner', () => {
    render(
      <LinkedWorkspaceAccessPanel
        linkedAccounts={FIXTURE_LINKED_ACCOUNTS}
        requests={[]}
        grants={[]}
        errors={{ 'request:link-1': "Couldn't send the request." }}
      />
    )
    const row = screen.getByText('me.personal@example.com').closest('li')
    expect(within(row).getByRole('alert')).toHaveTextContent("Couldn't send the request.")
    const otherRow = screen.getByText('me.work@example.com').closest('li')
    expect(within(otherRow).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes the confirm dialog once the revoke finishes with no error', () => {
    const grants = [{ linkId: 'link-1', email: 'me.personal@example.com', direction: 'granted', grantedAt: '2026-08-20T10:00:00Z' }]
    const { rerender } = render(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={[]} grants={grants} busyKey="revoke:link-1" />)
    const row = screen.getByText('me.personal@example.com').closest('li')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove access' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(<LinkedWorkspaceAccessPanel linkedAccounts={FIXTURE_LINKED_ACCOUNTS} requests={[]} grants={[]} busyKey={null} errors={{}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
