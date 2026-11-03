import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatAbsoluteDate } from '../../lib/dates'
import { useLanguage } from '../../context/LanguageContext'

const DIRECTION_KEYS = {
  sent: 'directionSent',
  received: 'directionReceived',
}

const STATUS_KEYS = {
  active: 'statusActive',
  revoked: 'statusRevoked',
}

const ACCOUNT_TYPE_KEYS = {
  personal: 'accountTypePersonal',
  work_sso: 'accountTypeWorkSso',
  work_managed: 'accountTypeWorkManaged',
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
  const { t } = useLanguage()
  const label = (keys, value) => (keys[value] ? t(`connectedAccounts.linkedAccountsList.${keys[value]}`) : value)
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
      <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.linkedAccountsList.heading')}</h3>
      <p className="text-sm text-secondary mb-4">
        {t('connectedAccounts.linkedAccountsList.description')}
      </p>

      {linkedAccounts.length === 0 ? (
        <p className="text-sm text-secondary py-2">{t('connectedAccounts.linkedAccountsList.emptyState')}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {linkedAccounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="text-sm text-ink truncate" title={account.email}>
                  {account.email}
                </p>
                <p className="text-xs text-secondary">
                  {t('connectedAccounts.linkedAccountsList.metaLine', {
                    accountType: label(ACCOUNT_TYPE_KEYS, account.accountType),
                    direction: label(DIRECTION_KEYS, account.direction),
                    date: formatAbsoluteDate(account.verifiedAt),
                    status: label(STATUS_KEYS, account.status),
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmTargetId(account.id)}
                className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
              >
                {t('connectedAccounts.linkedAccountsList.revokeButton')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmTarget && (
        <ConfirmDialog
          message={
            <>
              {t('connectedAccounts.linkedAccountsList.confirmMessage', { email: confirmTarget.email })}
              {error && (
                <span role="alert" className="block mt-2 text-red-700">
                  {error}
                </span>
              )}
            </>
          }
          confirmLabel={t('connectedAccounts.linkedAccountsList.confirmLabel')}
          confirming={revokingId === confirmTarget.id}
          onConfirm={() => onRevoke?.(confirmTarget.id)}
          onCancel={() => setConfirmTargetId(null)}
        />
      )}
    </div>
  )
}
