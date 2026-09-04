import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatAbsoluteDate } from '../../lib/dates'
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
      <h3 className="font-display text-lg text-ink mb-1">Share access between your logins</h3>
      <p className="text-sm text-secondary mb-4">
        Sharing gives a linked login full view access to a personal profile — yours or theirs. Nothing here
        moves or copies your records; either side can end it at any time.
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
                    <span className="font-medium text-ink">Your profile: </span>
                    {outgoingGrant
                      ? `they can view it, since ${formatAbsoluteDate(outgoingGrant.grantedAt)}`
                      : outgoingRequest
                        ? 'sharing request sent — waiting for them to accept'
                        : 'they cannot view it'}
                  </span>
                  {outgoingGrant ? (
                    <button
                      type="button"
                      onClick={() => setConfirming({ type: 'revoke', linkId: account.id, email: account.email })}
                      className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
                    >
                      Remove access
                    </button>
                  ) : outgoingRequest ? (
                    <button
                      type="button"
                      onClick={() => onCancelRequest?.(outgoingRequest.id)}
                      disabled={busyKey === `cancel:${outgoingRequest.id}`}
                      className="text-xs font-medium text-ink hover:underline whitespace-nowrap disabled:opacity-60"
                    >
                      {busyKey === `cancel:${outgoingRequest.id}` ? 'Cancelling…' : 'Cancel request'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRequest?.(account.id)}
                      disabled={busyKey === `request:${account.id}`}
                      className="text-xs font-medium text-moss hover:underline whitespace-nowrap disabled:opacity-60"
                    >
                      {busyKey === `request:${account.id}` ? 'Sending…' : 'Share your profile with them'}
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
                    <span className="font-medium text-ink">Their profile: </span>
                    {incomingGrant
                      ? `you can view it, since ${formatAbsoluteDate(incomingGrant.grantedAt)}`
                      : incomingRequest
                        ? 'they want to share it with you'
                        : 'you cannot view it'}
                  </span>
                  {incomingGrant ? (
                    <button
                      type="button"
                      onClick={() => setConfirming({ type: 'renounce', linkId: account.id, email: account.email })}
                      className="text-xs font-medium text-ink hover:underline whitespace-nowrap"
                    >
                      Give up access
                    </button>
                  ) : incomingRequest ? (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => onDecline?.(incomingRequest.id)}
                        disabled={busyKey === `decline:${incomingRequest.id}`}
                        className="text-xs font-medium text-ink hover:underline whitespace-nowrap disabled:opacity-60"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => onAccept?.(incomingRequest.id)}
                        disabled={busyKey === `accept:${incomingRequest.id}`}
                        className="text-xs font-medium text-moss hover:underline whitespace-nowrap disabled:opacity-60"
                      >
                        {busyKey === `accept:${incomingRequest.id}` ? 'Accepting…' : 'Accept'}
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
              {`Remove ${confirming.email}'s access to your profile? They'll no longer be able to view your skills, courses or experience through that login. You can share again later if you want to.`}
              {errors[`revoke:${confirming.linkId}`] && (
                <span role="alert" className="block mt-2 text-red-700">{errors[`revoke:${confirming.linkId}`]}</span>
              )}
            </>
          }
          confirmLabel="Remove access"
          confirming={busyKey === `revoke:${confirming.linkId}`}
          onConfirm={() => onRevoke?.(confirming.linkId)}
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirming && confirming.type === 'renounce' && confirmRow && (
        <ConfirmDialog
          message={
            <>
              {`Give up your access to ${confirming.email}'s profile? You'll no longer be able to view their skills, courses or experience. They can share it with you again later if you want.`}
              {errors[`renounce:${confirming.linkId}`] && (
                <span role="alert" className="block mt-2 text-red-700">{errors[`renounce:${confirming.linkId}`]}</span>
              )}
            </>
          }
          confirmLabel="Give up access"
          confirming={busyKey === `renounce:${confirming.linkId}`}
          onConfirm={() => onRenounce?.(confirming.linkId)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
