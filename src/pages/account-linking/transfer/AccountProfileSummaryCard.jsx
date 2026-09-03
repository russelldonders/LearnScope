const COUNT_FIELDS = [
  { key: 'skills', label: 'Skills' },
  { key: 'experience', label: 'Experience' },
  { key: 'courses', label: 'Courses & training' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'connections', label: 'Connections' },
  { key: 'integrations', label: 'External integrations' },
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
  return (
    <div
      className={`bg-card border rounded-lg p-6 ${selected ? 'border-moss ring-1 ring-moss' : 'border-hairline'}`}
    >
      <p className="text-sm font-medium text-ink truncate" title={account.email}>
        {account.email}
      </p>
      <p className="text-xs text-secondary mb-4">{account.accountType}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
        {COUNT_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-xs text-secondary">{label}</dt>
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
        {selected ? 'Selected as durable profile' : 'Select as durable profile'}
      </button>
    </div>
  )
}
