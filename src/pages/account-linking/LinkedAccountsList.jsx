import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatAbsoluteDate } from '../../lib/dates'

const DIRECTION_LABELS = {
  sent: 'Invited by you',
  received: 'Invited you',
}

const STATUS_LABELS = {
  active: 'Verified',
  revoked: 'Revoked',
}

// List of this learner's verified linked accounts. Revoking is the only
// mutation here (confirmed first, same ConfirmDialog pattern as
// ManagerTeamSharingPanel's "Leave team") -- a revoked link never deletes
// either account's own profile or history, only the verified connection
// between them.
//
// `revokingId`/`error` are owned by the caller: only one revoke confirm
// dialog is ever open at a time (local `confirmTargetId`), so a failure is
// shown inline in that same dialog rather than a generic banner that could
// be misread as belonging to a different row.
export default function LinkedAccountsList({ linkedAccounts, revokingId = null, error = null, onRevoke }) {
  const [confirmTargetId, setConfirmTargetId] = useState(null)
  const wasRevoking = useRef(revokingId)

  useEffect(() => {
    if (wasRevoking.current && !revokingId && !error) {
      setConfirmTargetId(null)
    }
    wasRevoking.current = revokingId
  }, [revokingId, error])

  const confirmTarget = linkedAccounts.find((a) => a.id === confirmTargetId) ?? null

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Linked accounts</h3>
      <p className="text-sm text-secondary mb-4">
        Accounts verified as belonging to you. Each keeps its own separate profile, skills and history --
        nothing here is merged or shared automatically.
      </p>

      {linkedAccounts.length === 0 ? (
        <p className="text-sm text-secondary py-2">You haven't linked any other accounts yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {linkedAccounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate" title={account.email}>
                  {account.email}
                </p>
                <p className="text-xs text-secondary">
                  {DIRECTION_LABELS[account.direction] ?? account.direction} · verified{' '}
                  {formatAbsoluteDate(account.verifiedAt)} · {STATUS_LABELS[account.status] ?? account.status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmTargetId(account.id)}
                className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmTarget && (
        <ConfirmDialog
          message={
            <>
              {`Revoke the verified link with ${confirmTarget.email}? Neither account's profile, skills or history are affected -- this only removes the verified connection between them. You can re-verify later if you both want to.`}
              {error && (
                <span role="alert" className="block mt-2 text-red-700">
                  {error}
                </span>
              )}
            </>
          }
          confirmLabel="Revoke"
          confirming={revokingId === confirmTarget.id}
          onConfirm={() => onRevoke?.(confirmTarget.id)}
          onCancel={() => setConfirmTargetId(null)}
        />
      )}
    </div>
  )
}
