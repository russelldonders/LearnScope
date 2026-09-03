import { useState } from 'react'
import { formatAbsoluteDate, formatRelativeDate } from '../../../lib/dates'

// Employer-proposed role assignments awaiting the learner's response -- the
// learner can never fabricate or freely browse-and-link a role profile
// themselves; this only ever responds to what an employer has already
// proposed (see src/pages/employer/roles/RoleProfileLinkedEmployeesPanel's
// "Assign by email").
//
// Accepting always carries a specific currentRoleExperienceId: with exactly
// one current role, that one is used without asking -- same convention as
// src/lib/currentRole.js's enableCurrentRole/trackUnderCurrentRole, no
// decision to make when it's unambiguous; with more than one, the learner
// must explicitly choose before Accept is enabled; with none, Accept stays
// disabled since there's nothing to link the assignment to.
export default function PendingAssignmentsPanel({
  pendingAssignments,
  currentRoles,
  responding = false,
  error = null,
  onAcceptAssignment,
  onDeclineAssignment,
}) {
  const [selectedRoleByAssignment, setSelectedRoleByAssignment] = useState({})

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
        const chosenCurrentRoleId =
          currentRoles.length === 1 ? currentRoles[0].id : selectedRoleByAssignment[assignment.assignmentId]

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
            <p className="text-sm text-secondary mt-2">
              Accepting adds an alignment view against your own skills -- it doesn't replace or hand over your
              current role, and you can disconnect at any time.
            </p>

            {currentRoles.length === 0 ? (
              <p className="text-xs text-red-700 mt-3">
                Add a current role from your Experience before you can accept this.
              </p>
            ) : (
              currentRoles.length > 1 && (
                <div className="mt-3">
                  <label
                    htmlFor={`assignment-current-role-${assignment.assignmentId}`}
                    className="block text-xs text-secondary mb-1"
                  >
                    Link to which current role?
                  </label>
                  <select
                    id={`assignment-current-role-${assignment.assignmentId}`}
                    value={chosenCurrentRoleId ?? ''}
                    disabled={responding}
                    onChange={(e) =>
                      setSelectedRoleByAssignment((prev) => ({
                        ...prev,
                        [assignment.assignmentId]: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
                  >
                    <option value="">Choose a current role…</option>
                    {currentRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.title} -- {role.organization}
                      </option>
                    ))}
                  </select>
                </div>
              )
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => onAcceptAssignment?.(assignment.assignmentId, chosenCurrentRoleId)}
                disabled={responding || !chosenCurrentRoleId}
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
