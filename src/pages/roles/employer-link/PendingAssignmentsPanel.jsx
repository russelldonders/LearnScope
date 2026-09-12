import { useState } from 'react'
import { formatAbsoluteDate, formatRelativeDate } from '../../../lib/dates'

// Employer-proposed role assignments awaiting the learner's response -- the
// learner can never fabricate or freely browse-and-link a role profile
// themselves; this only ever responds to what an employer has already
// proposed (see src/pages/employer/roles/RoleProfileLinkedEmployeesPanel's
// own multi-select add).
//
// Accepting no longer *requires* an existing current role -- with none,
// this just creates one (decide_employer_role_assignment, 20260912170000,
// titled after the role profile, at the employer's name). With at least
// one, the learner can choose to link to it instead of creating a new
// entry -- a genuine choice, not a blocker: Accept works either way.
export default function PendingAssignmentsPanel({
  pendingAssignments,
  currentRoles = [],
  responding = false,
  error = null,
  onAcceptAssignment,
  onDeclineAssignment,
}) {
  const [targetByAssignment, setTargetByAssignment] = useState({})

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
      {pendingAssignments.map((assignment) => {
        const target = targetByAssignment[assignment.assignmentId] ?? ''
        return (
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

            {currentRoles.length > 0 && (
              <div className="mt-3">
                <label
                  htmlFor={`assignment-target-${assignment.assignmentId}`}
                  className="block text-xs text-secondary mb-1"
                >
                  Link to
                </label>
                <select
                  id={`assignment-target-${assignment.assignmentId}`}
                  value={target}
                  disabled={responding}
                  onChange={(e) =>
                    setTargetByAssignment((prev) => ({ ...prev, [assignment.assignmentId]: e.target.value }))
                  }
                  className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">Create a new role for this</option>
                  {currentRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.title} -- {role.organization}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-sm text-secondary mt-2">
              {target
                ? 'Accepting links this to the role you chose above, with an alignment view against your own skills.'
                : "Accepting adds a new current role to your Experience timeline (titled after this role profile) and an alignment view against your own skills."}
              {' '}Its required skills are added to your own skill list too. You can disconnect at any time.
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => onAcceptAssignment?.(assignment.assignmentId, target || undefined)}
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
        )
      })}

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
