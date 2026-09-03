import MutationFeedback from '../../../components/MutationFeedback'

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
  const activeAccounts = linkedAccounts.filter((account) => account.status === 'active')

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <h3 className="font-display text-lg text-ink mb-1">Compare profiles</h3>
      <p className="text-sm text-secondary mb-4">
        Both accounts must approve before either can see profile totals or potential duplicates. Approval only
        opens a read-only comparison; it does not merge, move, delete, or share any records.
      </p>
      <MutationFeedback status="error" message={error} />

      {activeAccounts.length === 0 ? (
        <p className="text-sm text-secondary">Verify another account before requesting a comparison.</p>
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
                    {!preview && 'No comparison requested.'}
                    {preview?.status === 'pending' && preview.approvedByMe && 'Your approval is recorded. Waiting for the other account.'}
                    {preview?.status === 'pending' && !preview.approvedByMe && 'The other account requested a comparison. Your approval is required.'}
                    {preview?.status === 'approved' && 'Both accounts approved. The read-only comparison is available.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {!preview && (
                    <button type="button" disabled={busy} onClick={() => onRequest?.(account.id)} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60">
                      {busy ? 'Requesting…' : 'Request comparison'}
                    </button>
                  )}
                  {preview?.status === 'pending' && !preview.approvedByMe && (
                    <button type="button" disabled={busy} onClick={() => onApprove?.(preview.id)} className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60">
                      {busy ? 'Approving…' : 'Approve comparison'}
                    </button>
                  )}
                  {preview?.status === 'approved' && (
                    <button type="button" disabled={busy} onClick={() => onOpen?.(preview.id)} className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60">
                      {busy ? 'Loading…' : 'View comparison'}
                    </button>
                  )}
                  {preview && (
                    <button type="button" disabled={busy} onClick={() => onCancel?.(preview.id)} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60">
                      Cancel
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
