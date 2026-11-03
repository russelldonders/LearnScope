import AccountProfileSummaryCard from './AccountProfileSummaryCard'
import TransferConflictsSummary from './TransferConflictsSummary'
import { FIXTURE_TRANSFER_PREVIEW } from './transferFixtures'
import { useLanguage } from '../../../context/LanguageContext'

// Purely presentational preview of a potential transfer between two
// already-verified linked accounts (see ../LinkedAccountsList) --
// comparison only, before any transfer exists. Nothing here moves,
// merges, deletes, or shares any data; selecting a durable profile and
// "reviewing a transfer plan" are both just staged intent, relayed
// upward via callbacks. Genuinely controlled: `durableProfileId` is owned
// by the caller (same contract as the employer/learner role-profile
// work), so clicking a card doesn't visually select it on its own --
// the caller has to feed the id back down.
//
// `continueAvailable` defaults to false because transfer-plan review and
// execution aren't built yet -- this component never implements that
// step, only exposes `onContinue` for whenever a real caller is ready to
// wire it up.
export default function TransferPreviewPanel({
  preview = FIXTURE_TRANSFER_PREVIEW,
  durableProfileId = null,
  loading = false,
  error = null,
  continueAvailable = false,
  onSelectDurableProfile,
  onContinue,
}) {
  const { t } = useLanguage()
  if (loading) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <p className="text-sm text-secondary">{t('connectedAccounts.transferPreviewPanel.loadingComparison')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.transferPreviewPanel.heading')}</h3>
        <p className="text-sm text-secondary">
          {t('connectedAccounts.transferPreviewPanel.needTwoAccounts')}
        </p>
      </div>
    )
  }

  const { accountA, accountB, conflicts } = preview

  return (
    <div className="space-y-6">
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">{t('connectedAccounts.transferPreviewPanel.heading')}</h3>
        <p className="text-sm text-secondary">
          {t('connectedAccounts.transferPreviewPanel.description')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AccountProfileSummaryCard
          account={accountA}
          selected={durableProfileId === accountA.id}
          onSelect={() => onSelectDurableProfile?.(accountA.id)}
        />
        <AccountProfileSummaryCard
          account={accountB}
          selected={durableProfileId === accountB.id}
          onSelect={() => onSelectDurableProfile?.(accountB.id)}
        />
      </div>

      <TransferConflictsSummary conflicts={conflicts} />

      <div className="bg-card border border-hairline rounded-lg p-6">
        <p className="text-sm text-secondary mb-3">
          {continueAvailable
            ? t('connectedAccounts.transferPreviewPanel.continueAvailableText')
            : t('connectedAccounts.transferPreviewPanel.continueUnavailableText')}
        </p>
        <button
          type="button"
          onClick={() => onContinue?.(durableProfileId)}
          disabled={!continueAvailable || !durableProfileId}
          className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {t('connectedAccounts.transferPreviewPanel.reviewPlanButton')}
        </button>
      </div>
    </div>
  )
}
