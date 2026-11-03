import MutationFeedback from '../../components/MutationFeedback'
import { useLanguage } from '../../context/LanguageContext'

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
  const { t } = useLanguage()
  if (!token) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.redeemInvitationPanel.missingLinkHeading')}</h3>
        <p className="text-sm text-secondary">
          {t('connectedAccounts.redeemInvitationPanel.missingLinkDescription')}
        </p>
      </div>
    )
  }

  if (redeemed) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.redeemInvitationPanel.verifiedHeading')}</h3>
        <p className="text-sm text-secondary">
          {t('connectedAccounts.redeemInvitationPanel.verifiedDescription')}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-card border border-hairline rounded-lg p-6 space-y-4">
      <h3 className="font-display text-lg text-ink">{t('connectedAccounts.redeemInvitationPanel.confirmHeading')}</h3>
      <p className="text-sm text-secondary">
        {invitationPreview
          ? t('connectedAccounts.redeemInvitationPanel.withPreview', { email: invitationPreview.inviterEmail })
          : t('connectedAccounts.redeemInvitationPanel.withoutPreview')}
      </p>

      <p className="text-xs text-secondary border-t border-hairline pt-3">
        {t('connectedAccounts.redeemInvitationPanel.disclaimer')}
      </p>

      <MutationFeedback status="error" message={error} />

      <button
        type="button"
        onClick={() => onRedeem?.(token)}
        disabled={redeeming}
        className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {redeeming ? t('connectedAccounts.redeemInvitationPanel.verifyingButton') : t('connectedAccounts.redeemInvitationPanel.confirmButton')}
      </button>
    </div>
  )
}
