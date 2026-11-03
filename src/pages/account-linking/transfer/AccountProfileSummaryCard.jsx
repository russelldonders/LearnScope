import { useLanguage } from '../../../context/LanguageContext'

const COUNT_FIELDS = [
  { key: 'skills', labelKey: 'connectedAccounts.accountProfileSummaryCard.countFieldSkills' },
  { key: 'experience', labelKey: 'connectedAccounts.accountProfileSummaryCard.countFieldExperience' },
  { key: 'courses', labelKey: 'connectedAccounts.accountProfileSummaryCard.countFieldCourses' },
  { key: 'evidence', labelKey: 'connectedAccounts.accountProfileSummaryCard.countFieldEvidence' },
  { key: 'connections', labelKey: 'connectedAccounts.accountProfileSummaryCard.countFieldConnections' },
  { key: 'integrations', labelKey: 'connectedAccounts.accountProfileSummaryCard.countFieldIntegrations' },
]

// Read-only summary of one verified account's profile, for side-by-side
// comparison before a transfer preview -- counts only, never the
// underlying records themselves. `account.counts[key]` of `null` means
// that category couldn't be loaded (see `account.countsError`), not that
// it's confirmed zero, so it renders as "--" rather than "0".
//
// `onSelect` takes no arguments -- the caller (TransferPreviewPanel) wraps
// it with this card's own account id when wiring onSelectDurableProfile,
// so this card stays reusable without needing to know that callback's name.
export default function AccountProfileSummaryCard({ account, selected = false, onSelect }) {
  const { t } = useLanguage()
  return (
    <div
      className={`bg-card border rounded-lg p-6 ${selected ? 'border-moss ring-1 ring-moss' : 'border-hairline'}`}
    >
      <p className="text-sm font-medium text-ink truncate" title={account.email}>
        {account.email}
      </p>
      <p className="text-xs text-secondary mb-4">{account.accountTypeKey ? t(account.accountTypeKey) : account.accountType}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
        {COUNT_FIELDS.map(({ key, labelKey }) => (
          <div key={key}>
            <dt className="text-xs text-secondary">{t(labelKey)}</dt>
            <dd className="text-sm text-ink font-medium">
              {account.counts[key] === null || account.counts[key] === undefined ? '—' : account.counts[key]}
            </dd>
          </div>
        ))}
      </dl>

      {account.countsError && <p className="text-xs text-red-700 mb-4">{account.countsError}</p>}

      <button
        type="button"
        onClick={() => onSelect?.()}
        aria-pressed={selected}
        className={`w-full rounded-md py-2 px-3 text-sm font-medium ${
          selected ? 'bg-moss text-paper hover:opacity-90' : 'border border-hairline text-ink hover:bg-paper'
        }`}
      >
        {selected ? t('connectedAccounts.accountProfileSummaryCard.selectedButton') : t('connectedAccounts.accountProfileSummaryCard.selectButton')}
      </button>
    </div>
  )
}
