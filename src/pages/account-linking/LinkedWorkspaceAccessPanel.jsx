import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatAbsoluteDate } from '../../lib/dates'
import { useLanguage } from '../../context/LanguageContext'
import { FIXTURE_LINKED_ACCOUNTS } from './accountLinkingFixtures'
import { FIXTURE_WORKSPACE_ACCESS_GRANTS, FIXTURE_WORKSPACE_ACCESS_REQUESTS } from './linkedWorkspaceAccessFixtures'

// Each verified, active linked account gets two independent lines here,
// because either side of a link can share access with the other
// independently -- "sharing your profile with them" and "your access to
// their profile" are not the same relationship and don't imply each other.
// A grant always wins over a pending request for the same direction (the
// RPCs refuse a new request once one is active), so per direction there is
// at most one of: no relationship / a pending request / an active grant.
function buildRows(linkedAccounts, requests, grants) {
  return linkedAccounts
    .filter((account) => account.status === 'active')
    .map((account) => {
      const outgoingGrant = grants.find((g) => g.linkId === account.id && g.direction === 'granted')
      const incomingGrant = grants.find((g) => g.linkId === account.id && g.direction === 'received')
      const outgoingRequest = requests.find((r) => r.linkId === account.id && r.direction === 'sent')
      const incomingRequest = requests.find((r) => r.linkId === account.id && r.direction === 'received')
      return { account, outgoingGrant, incomingGrant, outgoingRequest, incomingRequest }
    })
}

// Genuinely props-in/callbacks-out, same shape as AccountLinkingSection:
// owns no request/grant list itself, just renders what it's given and
// reports which linkId/requestId an action was taken on.
//
// `errors` is keyed the same way as `busyKey` (e.g. "revoke:<linkId>",
// "accept:<requestId>") so a failure shows inline next to the specific
// row/action it came from, rather than one banner shared across every
// linked account -- same reasoning as LinkedAccountsList's per-dialog error
// display. `errors.load` is shown at the top of the panel since it isn't
// tied to any one row (the initial list fetch itself failed).
export default function LinkedWorkspaceAccessPanel({
  linkedAccounts = FIXTURE_LINKED_ACCOUNTS,
  requests = FIXTURE_WORKSPACE_ACCESS_REQUESTS,
  grants = FIXTURE_WORKSPACE_ACCESS_GRANTS,
  busyKey = null,
  errors = {},
  onRequest,
  onAccept,
  onDecline,
  onCancelRequest,
  onRevoke,
  onRenounce,
}) {
  // Removing already-granted access is more consequential than sending or
  // cancelling a request (which never touches live access), so -- matching
  // LinkedAccountsList's confirm-before-revoke pattern -- these two go
  // through a confirmation step; the others act immediately.
  const { t } = useLanguage()
  const [confirming, setConfirming] = useState(null)
  const wasBusyKey = useRef(busyKey)

  useEffect(() => {
    if (confirming && wasBusyKey.current === `${confirming.type}:${confirming.linkId}` && !busyKey && !errors[wasBusyKey.current]) {
      setConfirming(null)
    }
    wasBusyKey.current = busyKey
  }, [busyKey, errors, confirming])

  const rows = buildRows(linkedAccounts, requests, grants)

  if (rows.length === 0) return null

  const confirmRow = confirming ? rows.find((r) => r.account.id === confirming.linkId) : null

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.linkedWorkspaceAccessPanel.heading')}</h3>
      <p className="text-sm text-secondary mb-4">
        {t('connectedAccounts.linkedWorkspaceAccessPanel.description')}
      </p>
      {errors.load && <p role="alert" className="text-sm text-red-700 mb-3">{errors.load}</p>}

      <ul className="divide-y divide-hairline">
        {rows.map(({ account, outgoingGrant, incomingGrant, outgoingRequest, incomingRequest }) => {
          const requestError = errors[`request:${account.id}`]
          const cancelError = outgoingRequest && errors[`cancel:${outgoingRequest.id}`]
          const acceptError = incomingRequest && errors[`accept:${incomingRequest.id}`]
          const declineError = incomingRequest && errors[`decline:${incomingRequest.id}`]

          return (
            <li key={account.id} className="py-3 space-y-2">
              <p className="text-sm text-ink truncate" title={account.email}>{account.email}</p>

              <div className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-secondary">
                    <span className="font-medium text-ink">{t('connectedAccounts.linkedWorkspaceAccessPanel.yourProfileLabel')} </span>
                    {outgoingGrant
                      ? t('connectedAccounts.linkedWorkspaceAccessPanel.outgoingGranted', { date: formatAbsoluteDate(outgoingGrant.grantedAt) })
                      : outgoingRequest
                        ? t('connectedAccounts.linkedWorkspaceAccessPanel.outgoingRequestSent')
                        : t('connectedAccounts.linkedWorkspaceAccessPanel.outgoingNone')}
                  </span>
                  {outgoingGrant ? (
                    <button
                      type="button"
                      onClick={() => setConfirming({ type: 'revoke', linkId: account.id, email: account.email })}
                      className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
                    >
                      {t('connectedAccounts.linkedWorkspaceAccessPanel.removeAccessButton')}
                    </button>
                  ) : outgoingRequest ? (
                    <button
                      type="button"
                      onClick={() => onCancelRequest?.(outgoingRequest.id)}
                      disabled={busyKey === `cancel:${outgoingRequest.id}`}
                      className="text-xs font-medium text-ink hover:underline whitespace-nowrap disabled:opacity-60"
                    >
                      {busyKey === `cancel:${outgoingRequest.id}` ? t('connectedAccounts.linkedWorkspaceAccessPanel.cancellingButton') : t('connectedAccounts.linkedWorkspaceAccessPanel.cancelRequestButton')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRequest?.(account.id)}
                      disabled={busyKey === `request:${account.id}`}
                      className="text-xs font-medium text-moss hover:underline whitespace-nowrap disabled:opacity-60"
                    >
                      {busyKey === `request:${account.id}` ? t('connectedAccounts.linkedWorkspaceAccessPanel.sendingButton') : t('connectedAccounts.linkedWorkspaceAccessPanel.shareButton')}
                    </button>
                  )}
                </div>
                {(requestError || cancelError) && (
                  <p role="alert" className="text-xs text-red-700 mt-1">{requestError || cancelError}</p>
                )}
              </div>

              <div className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-secondary">
                    <span className="font-medium text-ink">{t('connectedAccounts.linkedWorkspaceAccessPanel.theirProfileLabel')} </span>
                    {incomingGrant
                      ? t('connectedAccounts.linkedWorkspaceAccessPanel.incomingGranted', { date: formatAbsoluteDate(incomingGrant.grantedAt) })
                      : incomingRequest
                        ? t('connectedAccounts.linkedWorkspaceAccessPanel.incomingRequested')
                        : t('connectedAccounts.linkedWorkspaceAccessPanel.incomingNone')}
                  </span>
                  {incomingGrant ? (
                    <button
                      type="button"
                      onClick={() => setConfirming({ type: 'renounce', linkId: account.id, email: account.email })}
                      className="text-xs font-medium text-ink hover:underline whitespace-nowrap"
                    >
                      {t('connectedAccounts.linkedWorkspaceAccessPanel.giveUpAccessButton')}
                    </button>
                  ) : incomingRequest ? (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => onDecline?.(incomingRequest.id)}
                        disabled={busyKey === `decline:${incomingRequest.id}`}
                        className="text-xs font-medium text-ink hover:underline whitespace-nowrap disabled:opacity-60"
                      >
                        {t('connectedAccounts.linkedWorkspaceAccessPanel.declineButton')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onAccept?.(incomingRequest.id)}
                        disabled={busyKey === `accept:${incomingRequest.id}`}
                        className="text-xs font-medium text-moss hover:underline whitespace-nowrap disabled:opacity-60"
                      >
                        {busyKey === `accept:${incomingRequest.id}` ? t('connectedAccounts.linkedWorkspaceAccessPanel.acceptingButton') : t('connectedAccounts.linkedWorkspaceAccessPanel.acceptButton')}
                      </button>
                    </div>
                  ) : null}
                </div>
                {(acceptError || declineError) && (
                  <p role="alert" className="text-xs text-red-700 mt-1">{acceptError || declineError}</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {confirming && confirming.type === 'revoke' && confirmRow && (
        <ConfirmDialog
          message={
            <>
              {t('connectedAccounts.linkedWorkspaceAccessPanel.revokeConfirmMessage', { email: confirming.email })}
              {errors[`revoke:${confirming.linkId}`] && (
                <span role="alert" className="block mt-2 text-red-700">{errors[`revoke:${confirming.linkId}`]}</span>
              )}
            </>
          }
          confirmLabel={t('connectedAccounts.linkedWorkspaceAccessPanel.revokeConfirmLabel')}
          confirming={busyKey === `revoke:${confirming.linkId}`}
          onConfirm={() => onRevoke?.(confirming.linkId)}
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirming && confirming.type === 'renounce' && confirmRow && (
        <ConfirmDialog
          message={
            <>
              {t('connectedAccounts.linkedWorkspaceAccessPanel.renounceConfirmMessage', { email: confirming.email })}
              {errors[`renounce:${confirming.linkId}`] && (
                <span role="alert" className="block mt-2 text-red-700">{errors[`renounce:${confirming.linkId}`]}</span>
              )}
            </>
          }
          confirmLabel={t('connectedAccounts.linkedWorkspaceAccessPanel.renounceConfirmLabel')}
          confirming={busyKey === `renounce:${confirming.linkId}`}
          onConfirm={() => onRenounce?.(confirming.linkId)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
