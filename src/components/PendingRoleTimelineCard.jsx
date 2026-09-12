import { useState } from 'react'
import { formatRelativeDate } from '../lib/dates'

// A role profile an employer has proposed but the learner hasn't responded
// to yet -- rendered at the top of the Experience timeline, grayed out to
// read as "not yet real" next to the solid entries below it (same dot-and-
// line structure as TimelineItem, so it visually belongs to the same list
// rather than looking like an unrelated banner).
//
// Accepting either creates a new timeline entry in place (decide_employer_
// role_assignment, 20260912170000, titled after the role profile) or --
// when an existing employment entry is available -- links to that instead,
// the learner's own choice rather than a forced pick. Declining just
// removes this card.
export default function PendingRoleTimelineCard({ assignment, currentRoles = [], responding = false, onAccept, onDecline, isLast = false }) {
  const [target, setTarget] = useState('')

  return (
    <div className="flex gap-4 print:hidden">
      <div className="flex flex-col items-center">
        <span className="w-3 h-3 rounded-full mt-1.5 bg-hairline" />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className="bg-paper border border-dashed border-hairline rounded-lg p-4 mb-6 w-full opacity-80">
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">Suggested by {assignment.employerName}</span>
        <h3 className="font-display text-lg text-secondary">{assignment.roleProfile.name}</h3>
        {assignment.roleProfile.description && (
          <p className="text-sm text-secondary mt-1">{assignment.roleProfile.description}</p>
        )}
        <p className="font-mono text-xs text-secondary mt-2">{formatRelativeDate(assignment.proposedAt)}</p>

        {currentRoles.length > 0 && (
          <div className="mt-3">
            <label htmlFor={`pending-role-target-${assignment.assignmentId}`} className="block text-xs text-secondary mb-1">
              Link to
            </label>
            <select
              id={`pending-role-target-${assignment.assignmentId}`}
              value={target}
              disabled={responding}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded-md border border-hairline bg-card px-2 py-1.5 text-sm text-ink"
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

        <p className="text-xs text-secondary mt-2">
          {target
            ? 'Accepting links this to the role you chose above, with an alignment view against your own skills.'
            : 'Accepting adds this as a new current role on your timeline, with an alignment view against your own skills.'}
          {' '}Its required skills are added to your own skill list too. You can disconnect it at any time.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => onAccept?.(assignment.assignmentId, target || undefined)}
            disabled={responding}
            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => onDecline?.(assignment.assignmentId)}
            disabled={responding}
            className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-card disabled:opacity-60"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  )
}
