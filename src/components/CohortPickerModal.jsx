import AccessibleDialog from './AccessibleDialog'

// Shown in place of a plain "Enrol" click whenever a course has at least
// one cohort defined (20260902270000) -- lets a learner pick a specific
// scheduled run, with its own session schedule and seats-remaining, rather
// than enrolling into the abstract course. `cohorts` is already fetched by
// the caller (each call site checks listCourseCohorts before deciding
// whether to show this at all, so it isn't re-fetched here). The actual
// enrol call stays with the caller via onEnrol(cohortId), since each call
// site (CourseCatalogue.jsx/ProviderProfile.jsx/Actions.jsx) has its own
// existing skill-linking/state-update logic around enrolInCourseCohort.
export default function CohortPickerModal({ courseName, cohorts, enrolling, error, onEnrol, onClose }) {
  return (
    <AccessibleDialog
      labelledBy="cohort-picker-title"
      onClose={enrolling ? undefined : onClose}
      closeOnBackdrop={!enrolling}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <div className="flex items-center justify-between mb-1 gap-4">
        <h2 id="cohort-picker-title" className="font-display text-xl text-ink">Choose a cohort</h2>
        <button type="button" onClick={onClose} disabled={enrolling} className="shrink-0 text-secondary hover:text-ink text-sm disabled:opacity-50">
          Close
        </button>
      </div>
      <p className="text-sm text-secondary mb-4">
        {courseName} has specific scheduled runs — pick one to enrol into.
      </p>

      {error && <p role="alert" className="text-sm text-red-700 mb-3">{error}</p>}

      {cohorts.length === 0 ? (
        <p className="text-sm text-secondary">No cohorts are currently open for enrolment.</p>
      ) : (
        <div className="space-y-3">
          {cohorts.map((cohort) => {
            const full = cohort.capacity != null && cohort.seatsRemaining <= 0
            const closed = !cohort.enrolment_open
            const disabled = full || closed || enrolling
            return (
              <div key={cohort.id} className="border border-hairline rounded-md p-3">
                <p className="text-sm font-medium text-ink">{cohort.name}</p>
                <p className="text-xs text-secondary mt-0.5">
                  {cohort.start_date
                    ? `Starts ${new Date(cohort.start_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                    : 'Start date to be confirmed'}
                  {cohort.capacity != null && ` · ${Math.max(0, cohort.seatsRemaining)} of ${cohort.capacity} seats remaining`}
                </p>
                {cohort.sessions.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {cohort.sessions.slice(0, 3).map((session) => (
                      <li key={session.id} className="text-xs text-secondary">
                        {new Date(session.starts_at).toLocaleString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                        {session.title ? ` · ${session.title}` : ''}
                      </li>
                    ))}
                    {cohort.sessions.length > 3 && (
                      <li className="text-xs text-secondary">
                        +{cohort.sessions.length - 3} more session{cohort.sessions.length - 3 === 1 ? '' : 's'}
                      </li>
                    )}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => onEnrol(cohort.id)}
                  disabled={disabled}
                  className="mt-3 w-full rounded-md bg-moss text-paper py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {closed ? 'Enrolment closed' : full ? 'Full' : enrolling ? 'Enrolling…' : 'Enrol in this cohort'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </AccessibleDialog>
  )
}
