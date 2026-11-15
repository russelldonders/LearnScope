import { useCallback, useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatFullDate } from '../../lib/dates'
import { adminListResourceReports, adminResolveResourceReports, getResourceFileUrl } from '../../lib/skillResources'

const REASON_LABELS = {
  spam: 'Spam or advertising',
  inappropriate: 'Offensive or inappropriate',
  misleading: 'Wrong or misleading',
  other: 'Something else',
}

const AUDIENCE_LABELS = {
  private: 'Private',
  selected: 'Selected contacts',
  connections: 'All contacts',
  skill_public: 'Everyone tracking the skill',
}

// Learner resources that others have reported (see 0292). Removing takes a
// resource out of sharing for good -- its owner keeps it, privately --
// while dismissing leaves it as it is. Both are written to the audit log.
export default function AdminResourceReports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setReports(await adminListResourceReports())
  }, [])

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [load])

  async function resolve() {
    const { report, action } = confirming
    setActing(true)
    setError(null)
    try {
      await adminResolveResourceReports(report.resource_id, action)
      setNotice(action === 'remove' ? `“${report.title}” was removed from sharing.` : `Reports on “${report.title}” were dismissed.`)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActing(false)
      setConfirming(null)
    }
  }

  async function openFile(path) {
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const url = await getResourceFileUrl(path)
      if (tab) tab.location.href = url
    } catch (err) {
      tab?.close()
      setError(err.message)
    }
  }

  return (
    <AdminLayout>
      <h2 className="font-display text-lg text-ink">Reported resources</h2>
      <p className="text-sm text-secondary mb-4">
        Resources learners shared that someone reported. Removing one stops it being shared with anyone; its owner keeps
        it privately and is told it was removed. Dismissing leaves it as it is.
      </p>

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}
      {notice && <p role="status" className="text-sm text-moss mb-3">{notice}</p>}

      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-secondary">No open reports.</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.resource_id} className="rounded-md border border-hairline bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                {report.kind === 'file' ? (
                  <button type="button" onClick={() => openFile(report.file_path)} className="text-sm font-medium text-moss hover:underline text-left">
                    {report.title}
                  </button>
                ) : (
                  <a href={report.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-moss hover:underline break-all">
                    {report.title}
                  </a>
                )}
                <span className="rounded-full bg-red-700/15 text-red-700 px-2 py-0.5 text-xs font-medium">
                  {report.report_count} {Number(report.report_count) === 1 ? 'report' : 'reports'}
                </span>
              </div>
              <p className="mt-1 text-xs text-secondary">
                {report.kind === 'file' ? `Document · ${report.file_name ?? ''}` : report.kind === 'video' ? `Video · ${report.url}` : `Link · ${report.url}`}
              </p>
              {report.note && <p className="mt-1 text-sm text-secondary whitespace-pre-wrap break-words">{report.note}</p>}
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div><dt className="inline text-secondary">Shared by </dt><dd className="inline text-ink">{report.owner_label}</dd></div>
                <div><dt className="inline text-secondary">Skill </dt><dd className="inline text-ink">{report.skill_name}</dd></div>
                <div><dt className="inline text-secondary">Shared with </dt><dd className="inline text-ink">{AUDIENCE_LABELS[report.audience] ?? report.audience}</dd></div>
                <div><dt className="inline text-secondary">First reported </dt><dd className="inline text-ink">{formatFullDate(report.first_reported_at)}</dd></div>
              </dl>
              <p className="mt-2 text-xs text-ink">
                {(report.reasons ?? []).map((reason) => REASON_LABELS[reason] ?? reason).join(' · ')}
              </p>
              {report.details?.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {report.details.map((detail, index) => (
                    <li key={index} className="text-xs text-secondary italic whitespace-pre-wrap break-words">“{detail}”</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => setConfirming({ report, action: 'remove' })}
                  className="rounded-md bg-red-700 text-white text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60"
                >
                  Remove from sharing
                </button>
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => setConfirming({ report, action: 'dismiss' })}
                  className="rounded-md border border-hairline text-ink text-xs font-medium px-3 py-1.5 hover:bg-paper disabled:opacity-60"
                >
                  Dismiss reports
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <ConfirmDialog
          message={confirming.action === 'remove'
            ? `Remove “${confirming.report.title}” from sharing? No one else will see it again, and its owner can't share it again. They keep it privately.`
            : `Dismiss the reports on “${confirming.report.title}”? It stays shared as it is.`}
          confirmLabel={confirming.action === 'remove' ? 'Remove from sharing' : 'Dismiss reports'}
          confirming={acting}
          onConfirm={resolve}
          onCancel={() => setConfirming(null)}
        />
      )}
    </AdminLayout>
  )
}
