import MutationFeedback from '../../components/MutationFeedback'

// Redeems a one-time link invitation token -- the token itself is supplied
// by the parent (parsed from the URL by whatever real page hosts this),
// never read from the URL/routing by this component. `invitationPreview`
// is optional (the caller may not have looked up the token yet); when
// present it shows who's inviting before the learner confirms.
export default function RedeemInvitationPanel({
  token,
  invitationPreview = null,
  redeeming = false,
  redeemed = false,
  error = null,
  onRedeem,
}) {
  if (!token) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">Link invitation</h3>
        <p className="text-sm text-secondary">
          This link is missing or incomplete. Ask the account that invited you to send it again.
        </p>
      </div>
    )
  }

  if (redeemed) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">Accounts verified</h3>
        <p className="text-sm text-secondary">
          This account is now verified as linked. Nothing about either account's profile, records, or sharing
          settings has changed -- you can review both accounts' link status from Connected Accounts at any time.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6 space-y-4">
      <h3 className="font-display text-lg text-ink">Confirm this account is yours</h3>
      <p className="text-sm text-secondary">
        {invitationPreview
          ? `${invitationPreview.inviterEmail} wants to verify that this account and theirs both belong to you.`
          : "You're about to verify a link between this account and another one."}
      </p>

      <p className="text-xs text-secondary border-t border-hairline pt-3">
        Confirming won't merge either account's profile, move records between them, or automatically share
        employer or private information -- both accounts stay completely separate. This just marks them as
        verified as belonging to the same person.
      </p>

      <MutationFeedback status="error" message={error} />

      <button
        type="button"
        onClick={() => onRedeem?.(token)}
        disabled={redeeming}
        className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {redeeming ? 'Verifying…' : 'Confirm this is my account'}
      </button>
    </div>
  )
}
