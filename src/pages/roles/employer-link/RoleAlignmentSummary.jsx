import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../../components/ConfirmDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVEL_LABELS } from '../../../lib/levels'
import { formatAbsoluteDate } from '../../../lib/dates'
import { useLanguage } from '../../../context/LanguageContext'

const REQUIREMENTS = ['required', 'recommended']

// Bidirectional alignment view for an accepted role assignment -- read-only
// except for disconnecting it entirely. Everything under "Employer
// requirements" is owned and edited by the employer (see
// src/pages/employer/roles/); this component never lets the learner edit
// those values, only see how their own skills compare. `aligned`/`gaps` are
// pre-calculated by the caller (see roleAlignment.js's computeRoleAlignment)
// -- this component doesn't compute them itself.
//
// `disconnecting`/`error` are owned by the caller, same contract as
// ManagerTeamSharingPanel's onLeaveTeam: this reacts to `disconnecting`
// transitioning back to false with no error to close the confirm dialog,
// so a failed attempt leaves it open with the error visible instead of
// silently closing or getting lost behind the dialog.
export default function RoleAlignmentSummary({
  assignment,
  aligned,
  gaps,
  training,
  disconnecting = false,
  error = null,
  onDisconnect,
}) {
  const { t } = useLanguage()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const wasDisconnecting = useRef(disconnecting)

  useEffect(() => {
    if (wasDisconnecting.current && !disconnecting && !error) {
      setConfirmOpen(false)
    }
    wasDisconnecting.current = disconnecting
  }, [disconnecting, error])

  const { roleProfile } = assignment

  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
        <h3 className="font-display text-lg text-ink">{roleProfile.name}</h3>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm font-medium hover:bg-paper whitespace-nowrap self-start"
        >
          {t('roleAlignment.card.disconnect')}
        </button>
      </div>
      <p className="text-sm text-secondary mb-4">
        {t('roleAlignment.card.linkedSince', { employer: assignment.employerName, date: formatAbsoluteDate(assignment.linkedAt) })}
      </p>

      <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-2">
        {t('roleAlignment.card.requirementsBy', { employer: assignment.employerName })}
      </p>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-ink mb-1">{t('roleAlignment.card.aligned', { count: aligned.length })}</p>
          {aligned.length === 0 ? (
            <p className="text-sm text-secondary">{t('roleAlignment.card.noneAligned')}</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {aligned.map((skill) => (
                <li key={skill.skillId}>
                  {t('roleAlignment.card.alignedLine', {
                    name: skill.name,
                    level: LEVEL_LABELS[skill.learnerLevel] ?? skill.learnerLevel,
                    target: LEVEL_LABELS[skill.targetLevel] ?? skill.targetLevel,
                  })}
                  {skill.componentCoverage && (
                    <span className="block text-xs text-secondary">
                      {t('roleAlignment.card.coverage', {
                        percentage: skill.componentCoverage.percentage,
                        met: skill.componentCoverage.requiredMet,
                        total: skill.componentCoverage.requiredTotal,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">{t('roleAlignment.card.gaps', { count: gaps.length })}</p>
          {gaps.length === 0 ? (
            <p className="text-sm text-secondary">{t('roleAlignment.card.noGaps')}</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {gaps.map((skill) => (
                <li key={skill.skillId}>
                  {t('roleAlignment.card.gapLine', { name: skill.name, target: LEVEL_LABELS[skill.targetLevel] ?? skill.targetLevel })}
                  {skill.learnerLevel !== null
                    ? t('roleAlignment.card.gapAt', { level: LEVEL_LABELS[skill.learnerLevel] ?? skill.learnerLevel })
                    : t('roleAlignment.card.gapUntracked')}
                  {skill.componentCoverage && (
                    <span className="block text-xs text-secondary">
                      {t('roleAlignment.card.coverage', {
                        percentage: skill.componentCoverage.percentage,
                        met: skill.componentCoverage.requiredMet,
                        total: skill.componentCoverage.requiredTotal,
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">{t('roleAlignment.card.training')}</p>
          {training.length === 0 ? (
            <p className="text-sm text-secondary">{t('roleAlignment.card.noTraining')}</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {training.map((item) => (
                <li key={item.courseId}>
                  {item.title}{' '}
                  <span className="text-secondary">({REQUIREMENTS.includes(item.requirement) ? t(`roleAlignment.card.${item.requirement}`) : item.requirement})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!confirmOpen && <MutationFeedback status="error" message={error} className="mt-4" />}

      {confirmOpen && (
        <ConfirmDialog
          message={
            <>
              {t('roleAlignment.card.confirm', { name: roleProfile.name })}
              {error && (
                <span role="alert" className="block mt-2 text-red-700">
                  {error}
                </span>
              )}
            </>
          }
          confirmLabel={t('roleAlignment.card.disconnect')}
          confirming={disconnecting}
          onConfirm={() => onDisconnect?.()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  )
}
