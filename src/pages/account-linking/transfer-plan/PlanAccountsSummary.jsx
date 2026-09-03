// Read-only identification of which verified account is "durable" (stays
// as the primary profile) and which is "source" (the one whose records
// this plan proposes reviewing against it). Purely informational -- this
// plan proposes a review, it doesn't move anything by itself.
export default function PlanAccountsSummary({ sourceAccount, durableAccount }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Accounts in this plan</h3>
      <p className="text-sm text-secondary mb-4">
        The durable account stays as the primary profile. Nothing moves until this plan is approved by both
        accounts and executed as a separate step.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border border-hairline rounded-md p-4">
          <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-1">Durable account</p>
          <p className="text-sm text-ink truncate" title={durableAccount.email}>
            {durableAccount.email}
          </p>
          <p className="text-xs text-secondary">{durableAccount.accountType}</p>
        </div>
        <div className="border border-hairline rounded-md p-4">
          <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-1">Source account</p>
          <p className="text-sm text-ink truncate" title={sourceAccount.email}>
            {sourceAccount.email}
          </p>
          <p className="text-xs text-secondary">{sourceAccount.accountType}</p>
        </div>
      </div>
    </div>
  )
}
