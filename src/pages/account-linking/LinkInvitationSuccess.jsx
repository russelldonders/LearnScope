import { useState } from 'react'
import { formatAbsoluteDate, formatRelativeDate } from '../../lib/dates'

// Shown once a link invitation has been created -- `invitation.url` is the
// ready-to-copy one-time link (built by the caller from the real token +
// origin + route; this component never constructs URLs itself). Purely
// presentational and read-only except for the clipboard copy and the
// optional `onDismiss` to go back to the create form.
export default function LinkInvitationSuccess({ invitation, onDismiss }) {
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
      <h3 className="font-display text-lg text-ink">Invitation created</h3>
      <p className="text-sm text-secondary">
        Share this one-time link with <strong>{invitation.invitedEmail}</strong>. It only works once, and expires{' '}
        {formatRelativeDate(invitation.expiresAt)} ({formatAbsoluteDate(invitation.expiresAt)}).
      </p>

      <div className="flex items-center gap-2">
        <input
          readOnly
          value={invitation.url}
          onFocus={(e) => e.target.select()}
          aria-label="One-time link"
          className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>

      <p className="text-sm text-secondary">
        <strong>{invitation.invitedEmail}</strong> needs to sign out of any other LearnScope account, then open
        this link while signed in as that account, to confirm it's theirs.
      </p>

      <p className="text-xs text-secondary border-t border-hairline pt-3">
        Verifying this link won't merge either account's profile, move records between them, or automatically
        share employer or private information -- both accounts stay completely separate.
      </p>

      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss?.()}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
        >
          Create another invitation
        </button>
      )}
    </div>
  )
}
