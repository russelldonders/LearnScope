import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferPreviewConsentPanel from './TransferPreviewConsentPanel'

afterEach(cleanup)

const account = { id: 'link-1', email: 'work@example.com', status: 'active' }

describe('TransferPreviewConsentPanel', () => {
  it('does not expose comparison content before a request exists', () => {
    const onRequest = vi.fn()
    render(<TransferPreviewConsentPanel linkedAccounts={[account]} previews={[]} onRequest={onRequest} />)
    fireEvent.click(screen.getByRole('button', { name: 'Request comparison' }))
    expect(onRequest).toHaveBeenCalledWith('link-1')
    expect(screen.queryByText('Potential conflicts')).not.toBeInTheDocument()
  })

  it('lets the second account explicitly approve', () => {
    const onApprove = vi.fn()
    render(<TransferPreviewConsentPanel linkedAccounts={[account]} previews={[{ id: 'preview-1', linkId: 'link-1', status: 'pending', approvedByMe: false }]} onApprove={onApprove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve comparison' }))
    expect(onApprove).toHaveBeenCalledWith('preview-1')
  })

  it('only offers the comparison after both approvals', () => {
    const onOpen = vi.fn()
    render(<TransferPreviewConsentPanel linkedAccounts={[account]} previews={[{ id: 'preview-1', linkId: 'link-1', status: 'approved', approvedByMe: true }]} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'View comparison' }))
    expect(onOpen).toHaveBeenCalledWith('preview-1')
  })
})
