import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlanApprovalPanel from './PlanApprovalPanel'
import { FIXTURE_DURABLE_ACCOUNT, FIXTURE_SOURCE_ACCOUNT } from './transferPlanFixtures'

afterEach(cleanup)

function renderPanel(props = {}) {
  return render(
    <PlanApprovalPanel
      status="pending"
      version={1}
      expiresAt="2026-09-15T10:00:00Z"
      approvals={[]}
      sourceAccount={FIXTURE_SOURCE_ACCOUNT}
      durableAccount={FIXTURE_DURABLE_ACCOUNT}
      currentAccountId={FIXTURE_DURABLE_ACCOUNT.id}
      allConflictsResolved
      {...props}
    />
  )
}

describe('PlanApprovalPanel', () => {
  it('shows the status label and description', () => {
    renderPanel({ status: 'pending' })
    expect(screen.getByText('Pending approval')).toBeInTheDocument()
    expect(screen.getByText(/Waiting for both accounts to approve/)).toBeInTheDocument()
  })

  it('shows neither account as approved yet with no approvals', () => {
    renderPanel({ approvals: [] })
    expect(screen.getAllByText('Has not approved this plan yet.')).toHaveLength(2)
  })

  it('flags an approval made against an earlier version as stale, not current', () => {
    renderPanel({
      version: 3,
      approvals: [{ accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-01T09:00:00Z', approvedVersion: 2 }],
    })
    expect(screen.getByText(/Approved an earlier version of this plan/)).toBeInTheDocument()
    // A stale approval doesn't count -- the Approve button (not Withdraw) still shows for the current viewer.
    expect(screen.getByRole('button', { name: 'Approve this plan' })).toBeInTheDocument()
  })

  it('shows a current approval as such, and switches the current viewer to Withdraw', () => {
    renderPanel({
      version: 2,
      approvals: [{ accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 }],
    })
    expect(screen.getByText(/Approved this version/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw approval' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve this plan' })).not.toBeInTheDocument()
  })

  it('disables Approve until every conflict is resolved, with an explanatory note', () => {
    renderPanel({ allConflictsResolved: false })
    expect(screen.getByRole('button', { name: 'Approve this plan' })).toBeDisabled()
    expect(screen.getByText('Resolve every conflict above before approving.')).toBeInTheDocument()
  })

  it("requires the acknowledgement checkbox before the dialog's own Approve button enables", () => {
    const onApprove = vi.fn()
    renderPanel({ onApprove })
    fireEvent.click(screen.getByRole('button', { name: 'Approve this plan' }))

    const dialog = screen.getByRole('dialog')
    const dialogApprove = within(dialog).getByRole('button', { name: 'Approve this plan' })
    expect(dialogApprove).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(dialogApprove).not.toBeDisabled()
    fireEvent.click(dialogApprove)
    expect(onApprove).toHaveBeenCalledWith()
  })

  it('surfaces a failed approve attempt inline in the dialog', () => {
    renderPanel({ error: "Couldn't approve -- try again." })
    fireEvent.click(screen.getByRole('button', { name: 'Approve this plan' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't approve -- try again.")
  })

  it('closes the approve dialog once approving finishes with no error', () => {
    const { rerender } = renderPanel({ approving: true })
    fireEvent.click(screen.getByRole('button', { name: 'Approve this plan' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(
      <PlanApprovalPanel
        status="pending"
        version={1}
        expiresAt="2026-09-15T10:00:00Z"
        approvals={[]}
        sourceAccount={FIXTURE_SOURCE_ACCOUNT}
        durableAccount={FIXTURE_DURABLE_ACCOUNT}
        currentAccountId={FIXTURE_DURABLE_ACCOUNT.id}
        allConflictsResolved
        approving={false}
        error={null}
      />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirms before withdrawing, and calls onWithdrawApproval with no arguments', () => {
    const onWithdrawApproval = vi.fn()
    renderPanel({
      version: 2,
      approvals: [{ accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 }],
      onWithdrawApproval,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw approval' }))
    // Two "Withdraw approval" buttons now exist: the panel's trigger and
    // the confirm dialog's own confirm button -- the dialog's is the second.
    const withdrawButtons = screen.getAllByRole('button', { name: 'Withdraw approval' })
    fireEvent.click(withdrawButtons[withdrawButtons.length - 1])
    expect(onWithdrawApproval).toHaveBeenCalledWith()
  })

  it('surfaces a failed withdraw attempt inline in the confirm dialog', () => {
    renderPanel({
      version: 2,
      approvals: [{ accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 }],
      error: "Couldn't withdraw -- try again.",
    })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw approval' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't withdraw -- try again.")
  })

  it.each(['executed', 'cancelled', 'expired'])('hides Approve/Withdraw entirely once the plan is %s', (status) => {
    renderPanel({
      status,
      version: 2,
      approvals: [{ accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 }],
    })
    expect(screen.queryByRole('button', { name: 'Approve this plan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Withdraw approval' })).not.toBeInTheDocument()
  })

  describe('execute', () => {
    function renderApprovedPanel(props = {}) {
      return renderPanel({
        status: 'approved',
        version: 2,
        approvals: [
          { accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 },
          { accountId: FIXTURE_SOURCE_ACCOUNT.id, approvedAt: '2026-09-03T09:00:00Z', approvedVersion: 2 },
        ],
        ...props,
      })
    }

    it('only shows Execute once the plan is approved', () => {
      renderPanel({ status: 'pending' })
      expect(screen.queryByRole('button', { name: 'Execute this transfer' })).not.toBeInTheDocument()
    })

    it.each(['executed', 'cancelled', 'expired'])('hides Execute once the plan is %s', (status) => {
      renderPanel({ status })
      expect(screen.queryByRole('button', { name: 'Execute this transfer' })).not.toBeInTheDocument()
    })

    it('shows Execute alongside Withdraw once approved -- both remain valid actions', () => {
      renderApprovedPanel()
      expect(screen.getByRole('button', { name: 'Execute this transfer' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Withdraw approval' })).toBeInTheDocument()
    })

    it("requires typing 'execute' before the dialog's own button enables", () => {
      const onExecute = vi.fn()
      renderApprovedPanel({ onExecute })
      fireEvent.click(screen.getByRole('button', { name: 'Execute this transfer' }))

      const dialog = screen.getByRole('dialog')
      const dialogExecute = within(dialog).getByRole('button', { name: 'Execute this transfer' })
      expect(dialogExecute).toBeDisabled()

      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'execute' } })
      expect(dialogExecute).not.toBeDisabled()
      fireEvent.click(dialogExecute)
      expect(onExecute).toHaveBeenCalledWith()
    })

    it('does not enable the dialog button for a near-miss confirmation phrase', () => {
      renderApprovedPanel()
      fireEvent.click(screen.getByRole('button', { name: 'Execute this transfer' }))
      const dialog = screen.getByRole('dialog')
      fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'executed' } })
      expect(within(dialog).getByRole('button', { name: 'Execute this transfer' })).toBeDisabled()
    })

    it('surfaces a failed execute attempt inline in the dialog', () => {
      renderApprovedPanel({ executeError: "Couldn't execute -- try again." })
      fireEvent.click(screen.getByRole('button', { name: 'Execute this transfer' }))
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't execute -- try again.")
    })

    it('closes the execute dialog once executing finishes with no error', () => {
      const { rerender } = renderApprovedPanel({ executing: true })
      fireEvent.click(screen.getByRole('button', { name: 'Execute this transfer' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      rerender(
        <PlanApprovalPanel
          status="approved"
          version={2}
          expiresAt="2026-09-15T10:00:00Z"
          approvals={[
            { accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 },
            { accountId: FIXTURE_SOURCE_ACCOUNT.id, approvedAt: '2026-09-03T09:00:00Z', approvedVersion: 2 },
          ]}
          sourceAccount={FIXTURE_SOURCE_ACCOUNT}
          durableAccount={FIXTURE_DURABLE_ACCOUNT}
          currentAccountId={FIXTURE_DURABLE_ACCOUNT.id}
          allConflictsResolved
          executing={false}
          executeError={null}
        />
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
