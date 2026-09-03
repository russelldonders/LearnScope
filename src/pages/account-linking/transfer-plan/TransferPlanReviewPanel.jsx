import PlanAccountsSummary from './PlanAccountsSummary'
import PlanCategoryBreakdown from './PlanCategoryBreakdown'
import PlanConflictResolutionList from './PlanConflictResolutionList'
import PlanApprovalPanel from './PlanApprovalPanel'
import { FIXTURE_CURRENT_ACCOUNT_ID, FIXTURE_PLAN_PENDING } from './transferPlanFixtures'

const TERMINAL_STATUSES = new Set(['executed', 'cancelled', 'expired'])

// Genuinely props-in/callbacks-out: composes the plan-review pieces above
// but owns no business data of its own -- the plan (including every
// conflict resolution and approval) is fully controlled by the caller.
// `onSelectResolution`/`onApprove`/`onWithdrawApproval` only ever propose
// what the caller should persist; nothing here executes a transfer or
// implies one has happened. FIXTURE_* imports are optional default props
// for an isolated render only, never substituted back in after a real
// callback fires.
export default function TransferPlanReviewPanel({
  plan = FIXTURE_PLAN_PENDING,
  currentAccountId = FIXTURE_CURRENT_ACCOUNT_ID,
  loading = false,
  error = null,
  resolving = false,
  resolutionError = null,
  approving = false,
  withdrawing = false,
  approvalError = null,
  onSelectResolution,
  onApprove,
  onWithdrawApproval,
}) {
  if (loading) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <p className="text-sm text-secondary">Loading transfer plan…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      </div>
    )
  }

  if (!plan) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">Transfer plan</h3>
        <p className="text-sm text-secondary">No transfer plan has been proposed yet.</p>
      </div>
    )
  }

  const isTerminal = TERMINAL_STATUSES.has(plan.status)
  const allConflictsResolved = plan.conflicts.every((c) => c.resolution !== null && c.resolution !== undefined)
  const myApproval = plan.approvals.find((a) => a.accountId === currentAccountId)
  const myApprovalIsCurrent = Boolean(myApproval) && myApproval.approvedVersion === plan.version
  // `resolving` also locks the radios (not just the callback) -- a control
  // left clickable but silently ignored is worse than one visibly disabled
  // while a resolution is being saved.
  const resolutionsReadOnly = isTerminal || myApprovalIsCurrent || resolving

  return (
    <div className="space-y-6">
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">Transfer plan review</h3>
        <p className="text-sm text-secondary">
          This is a proposed plan, not a completed action. Choosing a conflict resolution and approving here
          doesn't move, merge, delete, or share any data -- the transfer only runs once both accounts have
          approved this exact plan version, and execution happens as a separate step that isn't available yet.
        </p>
      </div>

      <PlanAccountsSummary sourceAccount={plan.sourceAccount} durableAccount={plan.durableAccount} />
      <PlanCategoryBreakdown categories={plan.categories} />
      <PlanConflictResolutionList
        conflicts={plan.conflicts}
        readOnly={resolutionsReadOnly}
        error={resolutionError}
        onSelectResolution={onSelectResolution}
      />
      <PlanApprovalPanel
        status={plan.status}
        version={plan.version}
        expiresAt={plan.expiresAt}
        approvals={plan.approvals}
        sourceAccount={plan.sourceAccount}
        durableAccount={plan.durableAccount}
        currentAccountId={currentAccountId}
        allConflictsResolved={allConflictsResolved}
        approving={approving}
        withdrawing={withdrawing}
        error={approvalError}
        onApprove={onApprove}
        onWithdrawApproval={onWithdrawApproval}
      />
    </div>
  )
}
