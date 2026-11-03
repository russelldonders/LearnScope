import { formatAbsoluteDate } from '../../../lib/dates'
import { useLanguage } from '../../../context/LanguageContext'

// Read-only display of the learner's own current role(s) -- sourced from
// their independently-managed Experience timeline
// (src/lib/currentRole.js's listCurrentRoleExperiences, which can return
// more than one ongoing role), not from any employer-managed role profile.
// Deliberately has no employer-facing fields or callbacks: accepting or
// disconnecting a role assignment (see PendingAssignmentsPanel,
// RoleAlignmentSummary) never edits this.
export default function CurrentRoleCard({ currentRoles }) {
  const { t } = useLanguage()
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-2">
        {t(currentRoles.length === 1 ? 'roleAlignment.currentRole.one' : 'roleAlignment.currentRole.many')}
      </p>
      {currentRoles.length === 0 ? (
        <p className="text-sm text-secondary">
          {t('roleAlignment.currentRole.none')}
        </p>
      ) : (
        <ul className="space-y-3">
          {currentRoles.map((role) => (
            <li key={role.id}>
              <h3 className="font-display text-lg text-ink">{role.title}</h3>
              <p className="text-sm text-secondary mt-0.5">
                {t('roleAlignment.currentRole.since', { organization: role.organization, date: formatAbsoluteDate(role.since) })}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-secondary mt-3">
        {t('roleAlignment.currentRole.footer')}
      </p>
    </div>
  )
}
