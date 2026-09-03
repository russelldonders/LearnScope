import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransferPlanReviewPanel from './TransferPlanReviewPanel'
import {
  FIXTURE_DURABLE_ACCOUNT,
  FIXTURE_PLAN_EXECUTED,
  FIXTURE_PLAN_PARTIALLY_APPROVED,
  FIXTURE_PLAN_PENDING,
  FIXTURE_SOURCE_ACCOUNT,
} from './transferPlanFixtures'

afterEach(cleanup)

describe('TransferPlanReviewPanel', () => {
  it('shows a loading state and nothing else', () => {
    render(<TransferPlanReviewPanel loading />)
    expect(screen.getByText('Loading transfer plan…')).toBeInTheDocument()
    expect(screen.queryByText('Transfer plan review')).not.toBeInTheDocument()
  })

  it('shows an error state and nothing else', () => {
    render(<TransferPlanReviewPanel error="Couldn't load this plan." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this plan.")
    expect(screen.queryByText('Transfer plan review')).not.toBeInTheDocument()
  })

  it('shows an empty state when there is no plan yet', () => {
    render(<TransferPlanReviewPanel plan={null} />)
    expect(screen.getByText('No transfer plan has been proposed yet.')).toBeInTheDocument()
  })

  it('states plainly this is a proposal, not a completed action', () => {
    render(<TransferPlanReviewPanel plan={FIXTURE_PLAN_PENDING} />)
    const warning = screen.getByText(/This is a proposed plan, not a completed action/)
    expect(warning).toHaveTextContent("doesn't move, merge, delete, or share any data")
  })

  it('renders accounts, categories, conflicts and approval status from the plan prop', () => {
    render(<TransferPlanReviewPanel plan={FIXTURE_PLAN_PENDING} />)
    expect(screen.getByText('Accounts in this plan')).toBeInTheDocument()
    expect(screen.getByText('Records by category')).toBeInTheDocument()
    expect(screen.getByText('Conflicts to resolve (3)')).toBeInTheDocument()
    expect(screen.getByText('Pending approval')).toBeInTheDocument()
  })

  it('leaves conflict resolutions editable while pending and not yet approved by the current viewer', () => {
    render(<TransferPlanReviewPanel plan={FIXTURE_PLAN_PENDING} currentAccountId={FIXTURE_DURABLE_ACCOUNT.id} />)
    expect(screen.getAllByRole('radio')[0]).not.toBeDisabled()
  })

  it("locks conflict resolutions once the current viewer's approval is on file for this version", () => {
    render(
      <TransferPlanReviewPanel plan={FIXTURE_PLAN_PARTIALLY_APPROVED} currentAccountId={FIXTURE_DURABLE_ACCOUNT.id} />
    )
    expect(screen.getAllByRole('radio')[0]).toBeDisabled()
  })

  it("does not lock resolutions for the account that hasn't approved this version yet", () => {
    render(
      <TransferPlanReviewPanel plan={FIXTURE_PLAN_PARTIALLY_APPROVED} currentAccountId={FIXTURE_SOURCE_ACCOUNT.id} />
    )
    expect(screen.getAllByRole('radio')[0]).not.toBeDisabled()
  })

  it('locks conflict resolutions (not just the callback) while a resolution save is in flight', () => {
    render(<TransferPlanReviewPanel plan={FIXTURE_PLAN_PENDING} resolving />)
    expect(screen.getAllByRole('radio')[0]).toBeDisabled()
  })

  it('locks conflict resolutions once the plan reaches a terminal status, for either account', () => {
    render(<TransferPlanReviewPanel plan={FIXTURE_PLAN_EXECUTED} currentAccountId={FIXTURE_SOURCE_ACCOUNT.id} />)
    expect(screen.getAllByRole('radio')[0]).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Approve this plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw approval' })).not.toBeInTheDocument()
  })

  it('calls onSelectResolution when a resolution is chosen', () => {
    const onSelectResolution = vi.fn()
    render(<TransferPlanReviewPanel plan={FIXTURE_PLAN_PENDING} onSelectResolution={onSelectResolution} />)
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(onSelectResolution).toHaveBeenCalledWith('conflict-1', 'keep_durable')
  })

  it('keeps resolution errors and approval errors separate', () => {
    render(
      <TransferPlanReviewPanel
        plan={FIXTURE_PLAN_PENDING}
        resolutionError="Couldn't save that resolution."
        approvalError="Couldn't approve -- try again."
      />
    )
    // The resolution error shows immediately.
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toContain("Couldn't save that resolution.")
    // The approval error only appears once its own dialog is open.
    fireEvent.click(screen.getByRole('button', { name: 'Approve this plan' }))
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toContain("Couldn't approve -- try again.")
  })
})
