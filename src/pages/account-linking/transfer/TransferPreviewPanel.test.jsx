import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferPreviewPanel from './TransferPreviewPanel'
import { FIXTURE_TRANSFER_PREVIEW } from './transferFixtures'

afterEach(cleanup)

describe('TransferPreviewPanel', () => {
  it('shows a loading state and nothing else', () => {
    render(<TransferPreviewPanel loading />)
    expect(screen.getByText('Loading account comparison…')).toBeInTheDocument()
    expect(screen.queryByText('Transfer preview')).not.toBeInTheDocument()
  })

  it('shows an error state and nothing else', () => {
    render(<TransferPreviewPanel error="Couldn't load this comparison." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this comparison.")
    expect(screen.queryByText('Transfer preview')).not.toBeInTheDocument()
  })

  it('shows an empty state when there is no second verified account to compare', () => {
    render(<TransferPreviewPanel preview={null} />)
    expect(screen.getByText(/You need two verified linked accounts/)).toBeInTheDocument()
  })

  it('states plainly that previewing and selecting do not move, merge, delete, or share data', () => {
    render(<TransferPreviewPanel preview={FIXTURE_TRANSFER_PREVIEW} />)
    const warning = screen.getByText(/doesn't move, merge, delete, or share/)
    expect(warning).toHaveTextContent("doesn't move, merge, delete, or share any data")
  })

  it('renders both account cards and the conflicts summary from the preview prop', () => {
    render(<TransferPreviewPanel preview={FIXTURE_TRANSFER_PREVIEW} />)
    expect(screen.getByText(FIXTURE_TRANSFER_PREVIEW.accountA.email)).toBeInTheDocument()
    expect(screen.getByText(FIXTURE_TRANSFER_PREVIEW.accountB.email)).toBeInTheDocument()
    expect(screen.getByText('Potential conflicts')).toBeInTheDocument()
  })

  it("surfaces one account's partial-data error without affecting the other", () => {
    render(<TransferPreviewPanel preview={FIXTURE_TRANSFER_PREVIEW} />)
    expect(screen.getByText(FIXTURE_TRANSFER_PREVIEW.accountB.countsError)).toBeInTheDocument()
  })

  it('selecting a durable profile calls onSelectDurableProfile with that account id, and does not self-select', () => {
    const onSelectDurableProfile = vi.fn()
    render(<TransferPreviewPanel preview={FIXTURE_TRANSFER_PREVIEW} onSelectDurableProfile={onSelectDurableProfile} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Select as durable profile' })[0])
    expect(onSelectDurableProfile).toHaveBeenCalledWith(FIXTURE_TRANSFER_PREVIEW.accountA.id)
    // Still unselected on screen -- the caller must feed durableProfileId back down.
    expect(screen.getAllByRole('button', { name: 'Select as durable profile' })).toHaveLength(2)
  })

  it('reflects durableProfileId as selected purely from props', () => {
    render(<TransferPreviewPanel preview={FIXTURE_TRANSFER_PREVIEW} durableProfileId={FIXTURE_TRANSFER_PREVIEW.accountB.id} />)
    expect(screen.getByRole('button', { name: 'Selected as durable profile' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Select as durable profile' })).toHaveLength(1)
  })

  it('keeps "Review transfer plan" disabled by default even with a profile selected -- transfer execution is not implemented', () => {
    render(<TransferPreviewPanel preview={FIXTURE_TRANSFER_PREVIEW} durableProfileId={FIXTURE_TRANSFER_PREVIEW.accountA.id} />)
    expect(screen.getByRole('button', { name: 'Review transfer plan' })).toBeDisabled()
    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument()
  })

  it('keeps "Review transfer plan" disabled when continueAvailable is true but nothing is selected yet', () => {
    render(<TransferPreviewPanel preview={FIXTURE_TRANSFER_PREVIEW} continueAvailable />)
    expect(screen.getByRole('button', { name: 'Review transfer plan' })).toBeDisabled()
  })

  it('calls onContinue with the durable profile id once continueAvailable and a profile are both set', () => {
    const onContinue = vi.fn()
    render(
      <TransferPreviewPanel
        preview={FIXTURE_TRANSFER_PREVIEW}
        durableProfileId={FIXTURE_TRANSFER_PREVIEW.accountA.id}
        continueAvailable
        onContinue={onContinue}
      />
    )
    const button = screen.getByRole('button', { name: 'Review transfer plan' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(onContinue).toHaveBeenCalledWith(FIXTURE_TRANSFER_PREVIEW.accountA.id)
  })
})
