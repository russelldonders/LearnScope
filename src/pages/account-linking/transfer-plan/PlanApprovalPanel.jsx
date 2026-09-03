import { useEffect, useId, useRef, useState } from 'react'
import AccessibleDialog from '../../../components/AccessibleDialog'
import ConfirmDialog from '../../../components/ConfirmDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import { formatAbsoluteDate, formatRelativeDate } from '../../../lib/dates'

const STATUS_LABELS = {
  pending: 'Pending approval',
  approved: 'Approved -- not yet executed',
  executed: 'Executed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

const STATUS_DESCRIPTIONS = {
  pending: 'Waiting for both accounts to approve this exact plan version. Nothing has moved.',
  approved:
    'Both accounts have approved this exact plan version. Nothing has moved yet -- execution happens as a separate step.',
  executed: 'This plan was executed.',
  cancelled: 'This plan was cancelled before execution. Nothing was moved.',
  expired: 'This plan expired before both accounts approved it. Nothing was moved.',
}

const TERMINAL_STATUSES = new Set(['executed', 'cancelled', 'expired'])

// Per-account approval state, including "both verified accounts must
// approve the exact immutable plan version" -- an approval recorded
// against an older `version` no longer counts once the plan has changed,
// and is shown as stale rather than silently ignored or silently honoured.
//
// `approving`/`withdrawing`/`error` are owned by the caller, same
// "caller owns the async lifecycle" contract used throughout this
// feature area: a failed attempt leaves the relevant dialog open with the
// error visible instead of closing prematurely.
export default function PlanApprovalPanel({
  status,
  version,
  expiresAt,
  approvals,
  sourceAccount,
  durableAccount,
  currentAccountId,
  allConflictsResolved,
  approving = false,
  withdrawing = false,
  error = null,
  onApprove,
  onWithdrawApproval,
}) {
  const [approveOpen, setApproveOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const wasApproving = useRef(approving)
  const wasWithdrawing = useRef(withdrawing)

  useEffect(() => {
    if (wasApproving.current && !approving && !error) setApproveOpen(false)
    wasApproving.current = approving
  }, [approving, error])

  useEffect(() => {
    if (wasWithdrawing.current && !withdrawing && !error) setWithdrawOpen(false)
    wasWithdrawing.current = withdrawing
  }, [withdrawing, error])

  const isTerminal = TERMINAL_STATUSES.has(status)
  const myApproval = approvals.find((a) => a.accountId === currentAccountId)
  const myApprovalIsCurrent = Boolean(myApproval) && myApproval.approvedVersion === version

  const accountsWithRole = [
    { ...durableAccount, roleLabel: 'Durable account' },
    { ...sourceAccount, roleLabel: 'Source account' },
  ]

  const anyDialogOpen = approveOpen || withdrawOpen

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="font-display text-lg text-ink">Approval</h3>
        <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-paper border border-hairline text-ink">
          {STATUS_LABELS[status] ?? status}
        </span>
      </div>
      <p className="text-sm text-secondary mb-4">{STATUS_DESCRIPTIONS[status] ?? ''}</p>

      {!isTerminal && expiresAt && (
        <p className="text-xs text-secondary mb-4">
          This plan version expires {formatRelativeDate(expiresAt)} ({formatAbsoluteDate(expiresAt)}) if it
          isn't approved by both accounts before then.
        </p>
      )}

      <ul className="divide-y divide-hairline mb-4">
        {accountsWithRole.map((account) => {
          const approval = approvals.find((a) => a.accountId === account.id)
          const isCurrent = Boolean(approval) && approval.approvedVersion === version
          return (
            <li key={account.id} className="py-2">
              <p className="text-sm text-ink truncate" title={account.email}>
                {account.email} <span className="text-xs text-secondary">({account.roleLabel})</span>
                {account.id === currentAccountId && <span className="text-xs text-secondary"> -- you</span>}
              </p>
              <p className="text-xs text-secondary">
                {!approval && 'Has not approved this plan yet.'}
                {approval &&
                  isCurrent &&
                  `Approved this version ${formatRelativeDate(approval.approvedAt)} (${formatAbsoluteDate(approval.approvedAt)}).`}
                {approval && !isCurrent && 'Approved an earlier version of this plan -- needs to approve this version.'}
              </p>
            </li>
          )
        })}
      </ul>

      {!anyDialogOpen && <MutationFeedback status="error" message={error} className="mb-3" />}

      {!isTerminal && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {myApprovalIsCurrent ? (
              <button
                type="button"
                onClick={() => setWithdrawOpen(true)}
                className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm font-medium hover:bg-paper whitespace-nowrap"
              >
                Withdraw approval
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setApproveOpen(true)}
                disabled={!allConflictsResolved}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
              >
                Approve this plan
              </button>
            )}
          </div>
          {!allConflictsResolved && !myApprovalIsCurrent && (
            <p className="text-xs text-secondary mt-2">Resolve every conflict above before approving.</p>
          )}
        </>
      )}

      {approveOpen && (
        <ApproveDialog
          approving={approving}
          error={error}
          onApprove={() => onApprove?.()}
          onClose={() => setApproveOpen(false)}
        />
      )}

      {withdrawOpen && (
        <ConfirmDialog
          message={
            <>
              {"Withdraw your approval of this plan? The other account's approval status is unaffected, but the plan can't execute until you approve again."}
              {error && (
                <span role="alert" className="block mt-2 text-red-700">
                  {error}
                </span>
              )}
            </>
          }
          confirmLabel="Withdraw approval"
          confirming={withdrawing}
          onConfirm={() => onWithdrawApproval?.()}
          onCancel={() => setWithdrawOpen(false)}
        />
      )}
    </div>
  )
}

function ApproveDialog({ approving, error, onApprove, onClose }) {
  const [acknowledged, setAcknowledged] = useState(false)
  const titleId = useId()

  return (
    <AccessibleDialog
      labelledBy={titleId}
      onClose={approving ? undefined : onClose}
      closeOnBackdrop={!approving}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id={titleId} className="font-display text-xl text-ink mb-1">
        Approve this transfer plan
      </h2>
      <p className="text-sm text-secondary mb-4">
        Approving records your consent to this exact plan version. It does not move, merge, or delete anything
        by itself -- the transfer only runs once <strong>both</strong> accounts have approved this same
        version, and execution happens as a separate step.
      </p>
      <ul className="text-sm text-secondary list-disc pl-5 mb-4 space-y-1">
        <li>
          If either account changes a conflict resolution afterwards, this approval no longer applies and both
          accounts need to approve again.
        </li>
        <li>You can withdraw your approval at any time before execution.</li>
        <li>Neither account's profile, skills, or history changes until the plan actually executes.</li>
      </ul>

      <label className="flex items-start gap-3 mb-4">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={approving}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm text-ink">
          I understand this approval applies only to this exact plan version and doesn't move any data by
          itself.
        </span>
      </label>

      <MutationFeedback status="error" message={error} className="mb-3" />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={approving || !acknowledged}
          className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {approving ? 'Approving…' : 'Approve this plan'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={approving}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </AccessibleDialog>
  )
}
