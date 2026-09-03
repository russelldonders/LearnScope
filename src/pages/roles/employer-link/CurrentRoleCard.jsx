import { formatAbsoluteDate } from '../../../lib/dates'

// Read-only display of the learner's own current role -- sourced from
// their independently-managed Experience timeline (src/lib/currentRole.js),
// not from any employer-managed role profile. Deliberately has no
// employer-facing fields or callbacks: linking to a role profile (see
// RoleProfileLinkPicker) never edits this.
export default function CurrentRoleCard({ currentRole }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-2">Your current role</p>
      {currentRole ? (
        <>
          <h3 className="font-display text-lg text-ink">{currentRole.title}</h3>
          <p className="text-sm text-secondary mt-0.5">
            {currentRole.organization} · since {formatAbsoluteDate(currentRole.since)}
          </p>
        </>
      ) : (
        <p className="text-sm text-secondary">
          You haven't added a current role yet -- add one from your Experience to link it to an employer's role
          profile.
        </p>
      )}
      <p className="text-xs text-secondary mt-3">
        This is yours to edit from your profile -- linking to an employer's role profile below never changes it.
      </p>
    </div>
  )
}
