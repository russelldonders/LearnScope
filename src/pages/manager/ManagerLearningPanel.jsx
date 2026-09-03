import MutationFeedback from '../../components/MutationFeedback'
import { formatRelativeDate, formatAbsoluteDate } from '../../lib/dates'

const KIND_LABELS = { course: 'Course', session: 'Session', other: 'Learning' }
const STATUS_LABELS = { planned: 'Planned', in_progress: 'In progress', completed: 'Completed' }

// Team-scoped collaborative learning -- courses, cohorts or sessions the
// team did together, visible to the manager because the record is
// inherently team-scoped, not because the manager can see a member's
// personal learning history. Read-only for now: how these records get
// created (course assignment, cohort enrolment, manual logging, ...) is a
// data-layer/product decision left to the eventual src/lib/managerTeams.js
// service, so no creation form is built here yet. Presentational only --
// `records`, `loading` and `error` are its whole contract with the data
// layer.
export default function ManagerLearningPanel({ records = [], loading = false, error = null }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">
        Courses and sessions your team has done together. This doesn't include any member's personal
        learning history outside the team.
      </p>

      <MutationFeedback status="error" message={error} />

      {loading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : records.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary text-sm">No collaborative learning logged for your team yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <div key={record.id} className="bg-card border border-hairline rounded-lg px-4 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5">
                    {KIND_LABELS[record.kind] ?? record.kind}
                  </span>
                  <p className="text-sm font-medium text-ink">{record.title}</p>
                </div>
                {record.occurredAt && (
                  <p className="font-mono text-xs text-secondary" title={formatAbsoluteDate(record.occurredAt)}>
                    {formatRelativeDate(record.occurredAt)}
                  </p>
                )}
              </div>
              <p className="text-xs text-secondary mt-1.5">
                {STATUS_LABELS[record.status] ?? record.status}
                {record.memberNames?.length > 0 ? ` · ${record.memberNames.join(', ')}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
