import { formatAbsoluteDate } from '../../../lib/dates'

// Read-only display of the learner's own current role(s) -- sourced from
// their independently-managed Experience timeline
// (src/lib/currentRole.js's listCurrentRoleExperiences, which can return
// more than one ongoing role), not from any employer-managed role profile.
// Deliberately has no employer-facing fields or callbacks: accepting or
// disconnecting a role assignment (see PendingAssignmentsPanel,
// RoleAlignmentSummary) never edits this.
export default function CurrentRoleCard({ currentRoles }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-2">
        Your current role{currentRoles.length === 1 ? '' : 's'}
      </p>
      {currentRoles.length === 0 ? (
        <p className="text-sm text-secondary">
          You haven't added a current role yet -- add one from your Experience before you can accept a role
          assignment.
        </p>
      ) : (
        <ul className="space-y-3">
          {currentRoles.map((role) => (
            <li key={role.id}>
              <h3 className="font-display text-lg text-ink">{role.title}</h3>
              <p className="text-sm text-secondary mt-0.5">
                {role.organization} · since {formatAbsoluteDate(role.since)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-secondary mt-3">
        This is yours to edit from your profile -- accepting or linking a role assignment below never changes it.
      </p>
    </div>
  )
}
