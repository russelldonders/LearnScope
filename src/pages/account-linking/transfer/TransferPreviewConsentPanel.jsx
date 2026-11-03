import MutationFeedback from '../../../components/MutationFeedback'
import { useLanguage } from '../../../context/LanguageContext'

export default function TransferPreviewConsentPanel({
  linkedAccounts,
  previews,
  busyId = null,
  error = null,
  onRequest,
  onApprove,
  onCancel,
  onOpen,
}) {
  const { t } = useLanguage()
  const activeAccounts = linkedAccounts.filter((account) => account.status === 'active')

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.transferPreviewConsentPanel.heading')}</h3>
      <p className="text-sm text-secondary mb-4">
        {t('connectedAccounts.transferPreviewConsentPanel.description')}
      </p>
      <MutationFeedback status="error" message={error} />

      {activeAccounts.length === 0 ? (
        <p className="text-sm text-secondary">{t('connectedAccounts.transferPreviewConsentPanel.verifyAnotherAccount')}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {activeAccounts.map((account) => {
            const preview = previews.find((item) => item.linkId === account.id && ['pending', 'approved'].includes(item.status))
            const busy = busyId === (preview?.id ?? account.id)
            return (
              <li key={account.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate" title={account.email}>{account.email}</p>
                  <p className="text-xs text-secondary mt-0.5">
                    {!preview && t('connectedAccounts.transferPreviewConsentPanel.noComparisonRequested')}
                    {preview?.status === 'pending' && preview.approvedByMe && t('connectedAccounts.transferPreviewConsentPanel.yourApprovalRecorded')}
                    {preview?.status === 'pending' && !preview.approvedByMe && t('connectedAccounts.transferPreviewConsentPanel.otherAccountRequested')}
                    {preview?.status === 'approved' && t('connectedAccounts.transferPreviewConsentPanel.bothApproved')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {!preview && (
                    <button type="button" disabled={busy} onClick={() => onRequest?.(account.id)} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60">
                      {busy ? t('connectedAccounts.transferPreviewConsentPanel.requestingButton') : t('connectedAccounts.transferPreviewConsentPanel.requestComparisonButton')}
                    </button>
                  )}
                  {preview?.status === 'pending' && !preview.approvedByMe && (
                    <button type="button" disabled={busy} onClick={() => onApprove?.(preview.id)} className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60">
                      {busy ? t('connectedAccounts.transferPreviewConsentPanel.approvingButton') : t('connectedAccounts.transferPreviewConsentPanel.approveComparisonButton')}
                    </button>
                  )}
                  {preview?.status === 'approved' && (
                    <button type="button" disabled={busy} onClick={() => onOpen?.(preview.id)} className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60">
                      {busy ? t('connectedAccounts.transferPreviewConsentPanel.loadingButton') : t('connectedAccounts.transferPreviewConsentPanel.viewComparisonButton')}
                    </button>
                  )}
                  {preview && (
                    <button type="button" disabled={busy} onClick={() => onCancel?.(preview.id)} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60">
                      {t('connectedAccounts.transferPreviewConsentPanel.cancelButton')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
