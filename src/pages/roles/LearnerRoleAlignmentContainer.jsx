import { useMyRoleAssignments } from './useMyRoleAssignments'
import LearnerRoleAlignmentSection from './employer-link/LearnerRoleAlignmentSection'
import { Link } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'

// employerId optionally scopes this down to one employer's own assignments
// (EmployerHome.jsx, reached via that employer's own URL) instead of every
// employer the learner has ever connected a role to (Experience.jsx used to
// use this without it too, showing every one of them here -- that's now
// integrated directly into the timeline instead, see ExperienceSection.jsx
// and useMyRoleAssignments' own comment).
function ProgressLine({ label, complete, total }) {
  const { t } = useLanguage()
  const percentage = total > 0 ? Math.round((complete / total) * 100) : 0
  return (
    <div>
      <div className="flex justify-between gap-4 text-sm">
        <span className="text-ink">{label}</span>
        <span className="font-mono text-xs text-secondary">{t('roleAlignment.summary.progress', { complete, total })}</span>
      </div>
      <div className="h-1.5 rounded-full bg-hairline mt-2 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-full bg-[var(--org-primary,var(--color-moss))]" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}

function RoleDevelopmentSummary({ pendingAssignments, linkedAssignments, alignmentByAssignmentId, loading, error, roleHref }) {
  const { t } = useLanguage()
  return (
    <section aria-labelledby="role-development-heading" className="mt-10 pt-8 border-t border-hairline">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-medium text-secondary uppercase tracking-[0.12em]">{t('roleAlignment.summary.eyebrow')}</p>
          <h2 id="role-development-heading" className="font-display text-2xl text-ink mt-1">{t('roleAlignment.summary.heading')}</h2>
        </div>
        <Link to={roleHref} className="text-sm font-medium text-[var(--org-text,var(--color-ink))] underline underline-offset-4 decoration-hairline hover:decoration-current">
          {t('roleAlignment.summary.viewDetails')}
        </Link>
      </div>

      {loading && <p className="text-sm text-secondary">{t('roleAlignment.summary.loading')}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!loading && pendingAssignments.length > 0 && (
        <Link to={roleHref} className="flex items-start gap-3 border-y border-hairline py-4 mb-4 hover:bg-card">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--org-primary,var(--color-moss))]" aria-hidden="true" />
          <span>
            <span className="block text-sm font-medium text-ink">{t('roleAlignment.summary.awaiting')}</span>
            <span className="block text-xs text-secondary mt-1">{t('roleAlignment.summary.awaitingDetail', { name: pendingAssignments[0].roleProfile.name })}</span>
          </span>
        </Link>
      )}
      {!loading && linkedAssignments.length > 0 && (
        <div className="divide-y divide-hairline border-y border-hairline">
          {linkedAssignments.map((assignment) => {
            const alignment = alignmentByAssignmentId[assignment.assignmentId] ?? {}
            const aligned = alignment.aligned ?? []
            const gaps = alignment.gaps ?? []
            const training = alignment.training ?? []
            return (
              <div key={assignment.assignmentId} className="py-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)] sm:items-center">
                <div>
                  <p className="font-medium text-ink">{assignment.roleProfile.name}</p>
                  <p className="text-sm text-secondary mt-1">{t('roleAlignment.summary.connected')}</p>
                </div>
                <div className="space-y-4">
                  <ProgressLine label={t('roleAlignment.summary.skillsMet')} complete={aligned.length} total={aligned.length + gaps.length} />
                  {training.length > 0 && (
                    <ProgressLine label={t('roleAlignment.summary.trainingComplete')} complete={training.filter((item) => item.completed).length} total={training.length} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {!loading && pendingAssignments.length === 0 && linkedAssignments.length === 0 && !error && (
        <p className="text-sm text-secondary border-y border-hairline py-5">{t('roleAlignment.summary.none')}</p>
      )}
    </section>
  )
}

export default function LearnerRoleAlignmentContainer({ employerId, variant = 'full', roleHref = '#' } = {}) {
  const {
    currentRoles, sharedCurrentRoles, pendingAssignments, linkedAssignments, alignmentByAssignmentId,
    loading, error, acceptAssignment, declineAssignment, disconnectAssignment,
  } = useMyRoleAssignments(employerId)
  const { t } = useLanguage()

  if (variant === 'summary') {
    return (
      <RoleDevelopmentSummary
        pendingAssignments={pendingAssignments}
        linkedAssignments={linkedAssignments}
        alignmentByAssignmentId={alignmentByAssignmentId}
        loading={loading}
        error={error}
        roleHref={roleHref}
      />
    )
  }

  return (
    <section aria-labelledby="role-alignment-heading">
      <div className="mb-6">
        <p className="text-xs font-medium text-secondary uppercase tracking-wide">{t('roleAlignment.full.eyebrow')}</p>
        <h2 id="role-alignment-heading" className="font-display text-2xl text-ink mt-1">{t('roleAlignment.full.heading')}</h2>
        <p className="text-sm text-secondary mt-2 max-w-2xl">
          {t('roleAlignment.full.intro')}
        </p>
      </div>
      <LearnerRoleAlignmentSection
        currentRoles={currentRoles}
        displayedCurrentRoles={employerId ? sharedCurrentRoles : undefined}
        pendingAssignments={pendingAssignments}
        linkedAssignments={linkedAssignments}
        alignmentByAssignmentId={alignmentByAssignmentId}
        linking={loading}
        disconnecting={loading}
        error={error}
        onAcceptAssignment={acceptAssignment}
        onDeclineAssignment={declineAssignment}
        onDisconnectAssignment={disconnectAssignment}
      />
    </section>
  )
}
