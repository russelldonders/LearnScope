import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../../components/ConfirmDialog'
import MutationFeedback from '../../../components/MutationFeedback'
import { LEVEL_LABELS } from '../../../lib/levels'
import { formatAbsoluteDate } from '../../../lib/dates'

const REQUIREMENT_LABELS = {
  required: 'Required',
  recommended: 'Recommended',
}

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
          Disconnect
        </button>
      </div>
      <p className="text-sm text-secondary mb-4">
        Linked to {assignment.employerName}'s role profile · since {formatAbsoluteDate(assignment.linkedAt)}
      </p>

      <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-2">
        Employer requirements -- managed by {assignment.employerName}
      </p>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-ink mb-1">Aligned ({aligned.length})</p>
          {aligned.length === 0 ? (
            <p className="text-sm text-secondary">No requirements met yet.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {aligned.map((skill) => (
                <li key={skill.skillId}>
                  {skill.name} -- at {LEVEL_LABELS[skill.learnerLevel] ?? skill.learnerLevel}, requires{' '}
                  {LEVEL_LABELS[skill.targetLevel] ?? skill.targetLevel}
                  {skill.componentCoverage && (
                    <span className="block text-xs text-secondary">
                      Component coverage {skill.componentCoverage.percentage}% · {skill.componentCoverage.requiredMet} of{' '}
                      {skill.componentCoverage.requiredTotal} required targets met
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">Gaps ({gaps.length})</p>
          {gaps.length === 0 ? (
            <p className="text-sm text-secondary">No gaps -- every required skill is met.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {gaps.map((skill) => (
                <li key={skill.skillId}>
                  {skill.name} -- requires {LEVEL_LABELS[skill.targetLevel] ?? skill.targetLevel}
                  {skill.learnerLevel !== null
                    ? `, you're at ${LEVEL_LABELS[skill.learnerLevel] ?? skill.learnerLevel}`
                    : ", you haven't tracked this skill yet"}
                  {skill.componentCoverage && (
                    <span className="block text-xs text-secondary">
                      Component coverage {skill.componentCoverage.percentage}% · {skill.componentCoverage.requiredMet} of{' '}
                      {skill.componentCoverage.requiredTotal} required targets met
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-ink mb-1">Employer training</p>
          {training.length === 0 ? (
            <p className="text-sm text-secondary">No training assigned for this role.</p>
          ) : (
            <ul className="text-sm text-ink space-y-1">
              {training.map((item) => (
                <li key={item.courseId}>
                  {item.title}{' '}
                  <span className="text-secondary">({REQUIREMENT_LABELS[item.requirement] ?? item.requirement})</span>
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
              {`Disconnect from ${roleProfile.name}? You'll stop seeing this alignment view. Your current role and skill history stay exactly as they are -- nothing is deleted.`}
              {error && (
                <span role="alert" className="block mt-2 text-red-700">
                  {error}
                </span>
              )}
            </>
          }
          confirmLabel="Disconnect"
          confirming={disconnecting}
          onConfirm={() => onDisconnect?.()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  )
}
