import { formatAbsoluteDate, formatRelativeDate } from '../../../lib/dates'

// Employer-proposed role assignments awaiting the learner's response -- the
// learner can never fabricate or freely browse-and-link a role profile
// themselves; this only ever responds to what an employer has already
// proposed (see src/pages/employer/roles/RoleProfileLinkedEmployeesPanel's
// own multi-select add).
//
// Accepting no longer needs an existing current role to link to --
// decide_employer_role_assignment (20260912120000) creates one itself
// (titled after the role profile, at the employer's name), so there's
// nothing left here to pick before Accept is enabled.
export default function PendingAssignmentsPanel({
  pendingAssignments,
  responding = false,
  error = null,
  onAcceptAssignment,
  onDeclineAssignment,
}) {
  if (pendingAssignments.length === 0) {
    return (
      <div className="bg-card border border-hairline rounded-lg p-6">
        <h3 className="font-display text-lg text-ink mb-1">Role assignments</h3>
        <p className="text-sm text-secondary">No role assignments from your employer right now.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {pendingAssignments.map((assignment) => (
        <div key={assignment.assignmentId} className="bg-card border border-hairline rounded-lg p-4">
          <p className="text-sm text-ink">
            <strong>{assignment.employerName}</strong> proposed the role profile{' '}
            <strong>{assignment.roleProfile.name}</strong>
          </p>
          {assignment.roleProfile.description && (
            <p className="text-sm text-secondary mt-1">{assignment.roleProfile.description}</p>
          )}
          <p className="font-mono text-xs text-secondary mt-1" title={formatAbsoluteDate(assignment.proposedAt)}>
            {formatRelativeDate(assignment.proposedAt)}
          </p>
          <p className="text-sm text-secondary mt-2">
            Accepting adds a new current role to your Experience timeline (titled after this role profile) and an
            alignment view against your own skills -- it doesn't touch any of your other roles, and you can
            disconnect at any time.
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => onAcceptAssignment?.(assignment.assignmentId)}
              disabled={responding}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onDeclineAssignment?.(assignment.assignmentId)}
              disabled={responding}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {/* Rendered once for the whole panel, not per-card -- `error` has no
          assignmentId of its own, so repeating it on every pending
          assignment would misleadingly imply they all just failed. */}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
