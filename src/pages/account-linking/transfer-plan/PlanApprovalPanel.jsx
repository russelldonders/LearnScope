import { useEffect, useId, useRef, useState } from 'react'
import AccessibleDialog from '../../../components/AccessibleDialog'
import ConfirmDialog from '../../../components/ConfirmDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import { formatAbsoluteDate, formatRelativeDate } from '../../../lib/dates'
import { useLanguage } from '../../../context/LanguageContext'

// status -> its planApprovalPanel.status{Key} / description{Key} strings.
const STATUS_KEYS = {
  pending: 'Pending',
  approved: 'Approved',
  executed: 'Executed',
  cancelled: 'Cancelled',
  expired: 'Expired',
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
  executing = false,
  error = null,
  executeError = null,
  onApprove,
  onWithdrawApproval,
  onExecute,
}) {
  const { t } = useLanguage()
  const [approveOpen, setApproveOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [executeOpen, setExecuteOpen] = useState(false)
  const wasApproving = useRef(approving)
  const wasWithdrawing = useRef(withdrawing)
  const wasExecuting = useRef(executing)

  useEffect(() => {
    if (wasApproving.current && !approving && !error) setApproveOpen(false)
    wasApproving.current = approving
  }, [approving, error])

  useEffect(() => {
    if (wasWithdrawing.current && !withdrawing && !error) setWithdrawOpen(false)
    wasWithdrawing.current = withdrawing
  }, [withdrawing, error])

  useEffect(() => {
    if (wasExecuting.current && !executing && !executeError) setExecuteOpen(false)
    wasExecuting.current = executing
  }, [executing, executeError])

  const isTerminal = TERMINAL_STATUSES.has(status)
  const myApproval = approvals.find((a) => a.accountId === currentAccountId)
  const myApprovalIsCurrent = Boolean(myApproval) && myApproval.approvedVersion === version

  const accountsWithRole = [
    { ...durableAccount, roleLabel: t('connectedAccounts.planApprovalPanel.durableAccountRole') },
    { ...sourceAccount, roleLabel: t('connectedAccounts.planApprovalPanel.sourceAccountRole') },
  ]

  const anyDialogOpen = approveOpen || withdrawOpen || executeOpen

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="font-display text-lg text-ink">{t('connectedAccounts.planApprovalPanel.heading')}</h3>
        <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-paper border border-hairline text-ink">
          {STATUS_KEYS[status] ? t(`connectedAccounts.planApprovalPanel.status${STATUS_KEYS[status]}`) : status}
        </span>
      </div>
      <p className="text-sm text-secondary mb-4">{STATUS_KEYS[status] ? t(`connectedAccounts.planApprovalPanel.description${STATUS_KEYS[status]}`) : ''}</p>

      {!isTerminal && expiresAt && (
        <p className="text-xs text-secondary mb-4">
          {t('connectedAccounts.planApprovalPanel.expiresNotice', { relative: formatRelativeDate(expiresAt), absolute: formatAbsoluteDate(expiresAt) })}
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
                {account.id === currentAccountId && <span className="text-xs text-secondary">{t('connectedAccounts.planApprovalPanel.youSuffix')}</span>}
              </p>
              <p className="text-xs text-secondary">
                {!approval && t('connectedAccounts.planApprovalPanel.notApprovedYet')}
                {approval &&
                  isCurrent &&
                  t('connectedAccounts.planApprovalPanel.approvedVersionLine', { relative: formatRelativeDate(approval.approvedAt), absolute: formatAbsoluteDate(approval.approvedAt) })}
                {approval && !isCurrent && t('connectedAccounts.planApprovalPanel.approvedEarlierVersion')}
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
                {t('connectedAccounts.planApprovalPanel.withdrawButton')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setApproveOpen(true)}
                disabled={!allConflictsResolved}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
              >
                {t('connectedAccounts.planApprovalPanel.approveButton')}
              </button>
            )}
          </div>
          {!allConflictsResolved && !myApprovalIsCurrent && (
            <p className="text-xs text-secondary mt-2">{t('connectedAccounts.planApprovalPanel.resolveConflictsNotice')}</p>
          )}
        </>
      )}

      {status === 'approved' && (
        <div className="mt-4 pt-4 border-t border-hairline">
          <p className="text-sm text-ink mb-2">
            {t('connectedAccounts.planApprovalPanel.bothApprovedNotice')}
          </p>
          {!anyDialogOpen && <MutationFeedback status="error" message={executeError} className="mb-3" />}
          <button
            type="button"
            onClick={() => setExecuteOpen(true)}
            className="rounded-md bg-red-700 text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 whitespace-nowrap"
          >
            {t('connectedAccounts.planApprovalPanel.executeButton')}
          </button>
        </div>
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
              {t('connectedAccounts.planApprovalPanel.withdrawConfirmMessage')}
              {error && (
                <span role="alert" className="block mt-2 text-red-700">
                  {error}
                </span>
              )}
            </>
          }
          confirmLabel={t('connectedAccounts.planApprovalPanel.withdrawConfirmLabel')}
          confirming={withdrawing}
          onConfirm={() => onWithdrawApproval?.()}
          onCancel={() => setWithdrawOpen(false)}
        />
      )}

      {executeOpen && (
        <ExecuteDialog
          executing={executing}
          error={executeError}
          onExecute={() => onExecute?.()}
          onClose={() => setExecuteOpen(false)}
        />
      )}
    </div>
  )
}

function ApproveDialog({ approving, error, onApprove, onClose }) {
  const { t } = useLanguage()
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
        {t('connectedAccounts.planApprovalPanel.approveDialogHeading')}
      </h2>
      <p className="text-sm text-secondary mb-4">
        {t('connectedAccounts.planApprovalPanel.approveDialogDescriptionPrefix')} <strong>{t('connectedAccounts.planApprovalPanel.approveDialogDescriptionBoth')}</strong>{' '}
        {t('connectedAccounts.planApprovalPanel.approveDialogDescriptionSuffix')}
      </p>
      <ul className="text-sm text-secondary list-disc pl-5 mb-4 space-y-1">
        <li>{t('connectedAccounts.planApprovalPanel.approveDialogBullet1')}</li>
        <li>{t('connectedAccounts.planApprovalPanel.approveDialogBullet2')}</li>
        <li>{t('connectedAccounts.planApprovalPanel.approveDialogBullet3')}</li>
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
          {t('connectedAccounts.planApprovalPanel.approveDialogAcknowledgeLabel')}
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
          {approving ? t('connectedAccounts.planApprovalPanel.approveDialogApprovingButton') : t('connectedAccounts.planApprovalPanel.approveDialogApproveButton')}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={approving}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
        >
          {t('connectedAccounts.planApprovalPanel.approveDialogCancelButton')}
        </button>
      </div>
    </AccessibleDialog>
  )
}

// The final, deliberate confirmation the handoff notes call for -- separate
// from approval, and not reachable except by a party who has already
// approved this exact version (the button above only renders once
// status === 'approved'). Requires typing a literal phrase, not just a
// checkbox, since this is the one action in this whole feature area that
// actually moves data instead of only recording consent.
function ExecuteDialog({ executing, error, onExecute, onClose }) {
  const { t } = useLanguage()
  const [confirmationText, setConfirmationText] = useState('')
  const titleId = useId()
  // The word to type is shown in the viewer's language, but the English
  // word is always accepted too.
  const typeWord = t('connectedAccounts.planApprovalPanel.executeDialogTypeWord')
  const typed = confirmationText.trim().toLowerCase()
  const canExecute = typed === typeWord.toLowerCase() || typed === 'execute'

  return (
    <AccessibleDialog
      labelledBy={titleId}
      onClose={executing ? undefined : onClose}
      closeOnBackdrop={!executing}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id={titleId} className="font-display text-xl text-ink mb-1">
        {t('connectedAccounts.planApprovalPanel.executeDialogHeading')}
      </h2>
      <p className="text-sm text-secondary mb-4">
        {t('connectedAccounts.planApprovalPanel.executeDialogDescription')}
      </p>
      <ul className="text-sm text-secondary list-disc pl-5 mb-4 space-y-1">
        <li>{t('connectedAccounts.planApprovalPanel.executeDialogBullet1')}</li>
        <li>{t('connectedAccounts.planApprovalPanel.executeDialogBullet2')}</li>
        <li>{t('connectedAccounts.planApprovalPanel.executeDialogBullet3')}</li>
      </ul>

      <label className="block mb-4">
        <span className="text-sm text-ink">
          {t('connectedAccounts.planApprovalPanel.executeDialogTypePrefix')} <strong>{typeWord}</strong> {t('connectedAccounts.planApprovalPanel.executeDialogTypeSuffix')}
        </span>
        <input
          type="text"
          value={confirmationText}
          disabled={executing}
          onChange={(e) => setConfirmationText(e.target.value)}
          className="mt-1 w-full rounded-md border border-hairline py-1.5 px-2 text-sm"
          autoComplete="off"
        />
      </label>

      <MutationFeedback status="error" message={error} className="mb-3" />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExecute}
          disabled={executing || !canExecute}
          className="flex-1 rounded-md bg-red-700 text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
        >
          {executing ? t('connectedAccounts.planApprovalPanel.executeDialogExecutingButton') : t('connectedAccounts.planApprovalPanel.executeDialogExecuteButton')}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={executing}
          className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
        >
          {t('connectedAccounts.planApprovalPanel.executeDialogCancelButton')}
        </button>
      </div>
    </AccessibleDialog>
  )
}
