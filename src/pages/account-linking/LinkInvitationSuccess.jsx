import { useState } from 'react'
import { formatAbsoluteDate, formatRelativeDate } from '../../lib/dates'
import { useLanguage } from '../../context/LanguageContext'

// Shown once a link invitation has been created -- `invitation.url` is the
// ready-to-copy one-time link (built by the caller from the real token +
// origin + route; this component never constructs URLs itself). Purely
// presentational and read-only except for the clipboard copy and the
// optional `onDismiss` to go back to the create form.
export default function LinkInvitationSuccess({ invitation, onDismiss }) {
  const { t } = useLanguage()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(invitation.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may be unavailable (e.g. insecure context) -- the URL
      // is still visible/selectable below, so this is a soft failure.
    }
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6 space-y-4">
      <h3 className="font-display text-lg text-ink">{t('connectedAccounts.linkInvitationSuccess.heading')}</h3>
      <p className="text-sm text-secondary">
        {t('connectedAccounts.linkInvitationSuccess.shareWithPrefix')} <strong>{invitation.invitedEmail}</strong>
        {t('connectedAccounts.linkInvitationSuccess.shareWithSuffix', {
          relative: formatRelativeDate(invitation.expiresAt),
          absolute: formatAbsoluteDate(invitation.expiresAt),
        })}
      </p>

      <div className="flex items-center gap-2">
        <input
          readOnly
          value={invitation.url}
          onFocus={(e) => e.target.select()}
          aria-label={t('connectedAccounts.linkInvitationSuccess.linkAriaLabel')}
          className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
        >
          {copied ? t('connectedAccounts.linkInvitationSuccess.copiedButton') : t('connectedAccounts.linkInvitationSuccess.copyButton')}
        </button>
      </div>

      <p className="text-sm text-secondary">
        <strong>{invitation.invitedEmail}</strong>
        {t('connectedAccounts.linkInvitationSuccess.signOutSuffix')}
      </p>

      <p className="text-xs text-secondary border-t border-hairline pt-3">
        {t('connectedAccounts.linkInvitationSuccess.disclaimer')}
      </p>

      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss?.()}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
        >
          {t('connectedAccounts.linkInvitationSuccess.createAnotherButton')}
        </button>
      )}
    </div>
  )
}
