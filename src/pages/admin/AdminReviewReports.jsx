import { useCallback, useEffect, useState } from 'react'
import AdminLayout from './AdminLayout'
import ConfirmDialog from '../../components/ConfirmDialog'
import { formatFullDate } from '../../lib/dates'
import { adminListCoachReviewReports, adminResolveCoachReviewReports } from '../../lib/coaching'

const REASON_LABELS = {
  spam: 'Spam or advertising',
  inappropriate: 'Offensive or inappropriate',
  misleading: 'Wrong or misleading',
  other: 'Something else',
}

// Coach reviews that someone reported (see 0338). Removing a review hides it
// from everyone but the learner who wrote it and stops it counting towards
// the coach's stars; dismissing leaves it as it is. Both are written to the
// audit log.
export default function AdminReviewReports() {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setReports(await adminListCoachReviewReports())
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
      await adminResolveCoachReviewReports(report.review_id, action)
      setNotice(action === 'remove'
        ? `The review of ${report.coach_label} by ${report.reviewer_label} was removed.`
        : `Reports on the review of ${report.coach_label} by ${report.reviewer_label} were dismissed.`)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setActing(false)
      setConfirming(null)
    }
  }

  return (
    <AdminLayout>
      <h2 className="font-display text-lg text-ink">Reported reviews</h2>
      <p className="text-sm text-secondary mb-4">
        Reviews of coaches that someone reported. Reviews are shown with the reviewer&apos;s name to anyone looking at
        that coach. Removing one hides it from everyone but the learner who wrote it, and it no longer counts towards the
        coach&apos;s stars; they can delete it but not change it. Dismissing leaves it as it is.
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
            <li key={report.review_id} className="rounded-md border border-hairline bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-medium text-ink">
                  <span aria-label={`${report.rating} out of 5 stars`} role="img" className="text-gold">
                    {'★'.repeat(report.rating)}
                    <span className="text-hairline">{'★'.repeat(5 - report.rating)}</span>
                  </span>
                </p>
                <span className="rounded-full bg-red-700/15 text-red-700 px-2 py-0.5 text-xs font-medium">
                  {report.report_count} {Number(report.report_count) === 1 ? 'report' : 'reports'}
                </span>
              </div>
              {report.comment
                ? <p className="mt-1 text-sm text-ink whitespace-pre-wrap break-words">{report.comment}</p>
                : <p className="mt-1 text-sm text-secondary">No comment, stars only.</p>}
              {/* Its author may have changed it since it was reported. */}
              {report.changed_since_reported && (
                <div className="mt-2 rounded-md border border-hairline bg-paper px-3 py-2 text-xs">
                  <p className="font-medium text-ink">Changed since it was reported. When reported, it said:</p>
                  <p className="mt-1 text-ink">
                    <span role="img" aria-label={`${report.reported_rating} out of 5 stars`} className="text-gold">
                      {'★'.repeat(report.reported_rating ?? 0)}
                      <span className="text-hairline">{'★'.repeat(5 - (report.reported_rating ?? 0))}</span>
                    </span>
                  </p>
                  {report.reported_comment
                    ? <p className="mt-0.5 text-ink whitespace-pre-wrap break-words">{report.reported_comment}</p>
                    : <p className="mt-0.5 text-secondary">No comment, stars only.</p>}
                </div>
              )}
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div><dt className="inline text-secondary">Written by </dt><dd className="inline text-ink">{report.reviewer_label}</dd></div>
                <div><dt className="inline text-secondary">About coach </dt><dd className="inline text-ink">{report.coach_label}</dd></div>
                <div><dt className="inline text-secondary">Skill </dt><dd className="inline text-ink">{report.skill_name}</dd></div>
                <div><dt className="inline text-secondary">Last changed </dt><dd className="inline text-ink">{formatFullDate(report.review_updated_at)}</dd></div>
                <div><dt className="inline text-secondary">First reported </dt><dd className="inline text-ink">{formatFullDate(report.first_reported_at)}</dd></div>
                {report.reporter_is_coach && (
                  <div><dt className="inline text-secondary">Reported by </dt><dd className="inline text-ink">the coach it&apos;s about, among others</dd></div>
                )}
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
                  Remove review
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
            ? `Remove the review of ${confirming.report.coach_label} by ${confirming.report.reviewer_label}? No one but its writer will see it again, and it won't count towards the coach's stars.`
            : `Dismiss the reports on the review of ${confirming.report.coach_label}? It stays shown as it is.`}
          confirmLabel={confirming.action === 'remove' ? 'Remove review' : 'Dismiss reports'}
          confirming={acting}
          onConfirm={resolve}
          onCancel={() => setConfirming(null)}
        />
      )}
    </AdminLayout>
  )
}
