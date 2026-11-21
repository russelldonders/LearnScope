import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AccessibleDialog from './AccessibleDialog'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { listMyPlanAssignments, respondToPlanAssignment } from '../lib/organisationPlans'

// The plans an organisation assigned the signed-in member (0328), in that
// organisation's workspace. Assigned ones wait for the member: Start joins
// them (after saying the organisation will see their progress, step by
// step), Not now dismisses. Started ones show how far they are and open the
// plan. Nothing from the member's other plans is shown.

const FRAMING_KEYS = {
  assigned: 'assignedPlans.assignedBy',
  required: 'assignedPlans.requiredBy',
  recommended: 'assignedPlans.recommendedBy',
}

// With `heading`, it's a card of its own that only appears once there's a
// plan to show (a workspace section); without, it's a bare list for a panel.
export default function AssignedPlansList({ organisationId, organisationName = null, framing = 'assigned', limit = null, emptyText = null, heading = null }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [assignments, setAssignments] = useState(null)
  const [error, setError] = useState(false)
  const [starting, setStarting] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState(null)

  const load = useCallback(() => {
    listMyPlanAssignments(organisationId)
      .then((rows) => { setAssignments(rows); setError(false) })
      .catch(() => setError(true))
  }, [organisationId])

  useEffect(() => { if (organisationId) load() }, [load, organisationId])

  async function respond(assignment, start) {
    setBusyId(assignment.id)
    setActionError(null)
    try {
      const planId = await respondToPlanAssignment(assignment.id, start)
      if (start) navigate(`/plans/${planId}`)
      else load()
    } catch {
      setActionError(t('assignedPlans.actionError'))
    } finally {
      setBusyId(null)
      setStarting(null)
    }
  }

  if (error) return heading ? null : <p className="text-sm text-red-700">{t('assignedPlans.loadError')}</p>
  if (!assignments) return heading ? null : <p className="text-sm text-secondary">{t('assignedPlans.loading')}</p>
  const shown = limit ? assignments.slice(0, limit) : assignments
  if (shown.length === 0) return emptyText && !heading ? <p className="text-sm text-secondary">{emptyText}</p> : null

  const content = (
    <>
      {actionError && <p role="alert" className="text-sm text-red-700 mb-2">{actionError}</p>}
      <ul className="divide-y divide-hairline">
        {shown.map((assignment) => {
          const name = organisationName ?? assignment.organisation_name
          const started = assignment.status === 'started'
          return (
            <li key={assignment.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{assignment.title}</p>
                  {!started && <p className="font-mono text-[10px] uppercase tracking-wide text-moss mt-0.5">{t(FRAMING_KEYS[framing] ?? FRAMING_KEYS.assigned, { employer: name })}</p>}
                  {assignment.description && <p className="text-xs text-secondary mt-1 line-clamp-2">{assignment.description}</p>}
                  <p className="text-xs text-secondary mt-1">
                    {t('assignedPlans.steps', { count: assignment.step_count })}
                    {assignment.target_on && ` · ${t('assignedPlans.finishBy', { date: formatFullDate(assignment.target_on) })}`}
                    {started && assignment.progress_total != null && ` · ${t('assignedPlans.progress', { done: assignment.progress_done, total: assignment.progress_total })}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {started ? (
                    <Link to={`/plans/${assignment.plan_id}`} className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
                      {t('assignedPlans.open')}
                    </Link>
                  ) : (
                    <>
                      <button type="button" disabled={busyId === assignment.id} onClick={() => setStarting(assignment)}
                        className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">
                        {t('assignedPlans.start')}
                      </button>
                      <button type="button" disabled={busyId === assignment.id} onClick={() => respond(assignment, false)}
                        className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60">
                        {t('assignedPlans.notNow')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {starting && (
        <AccessibleDialog
          labelledBy="start-plan-dialog-title"
          describedBy="start-plan-dialog-message"
          onClose={busyId ? undefined : () => setStarting(null)}
          panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6"
        >
          <h2 id="start-plan-dialog-title" className="font-display text-xl text-ink mb-2">{t('assignedPlans.startTitle', { plan: starting.title })}</h2>
          <div id="start-plan-dialog-message" className="space-y-2 text-sm text-ink">
            <p>{t('assignedPlans.startSharing', { employer: organisationName ?? starting.organisation_name })}</p>
            <p className="text-secondary">{t('assignedPlans.startRecords')}</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setStarting(null)} disabled={Boolean(busyId)}
              className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60">
              {t('assignedPlans.cancel')}
            </button>
            <button type="button" data-dialog-initial-focus onClick={() => respond(starting, true)} disabled={Boolean(busyId)}
              className="rounded-md bg-moss px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60">
              {busyId ? t('assignedPlans.starting') : t('assignedPlans.startConfirm')}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </>
  )
  if (!heading) return content
  return (
    <section className="mt-6 rounded-lg border border-hairline bg-card p-5" aria-label={heading}>
      <h2 className="font-display text-lg text-ink mb-3">{heading}</h2>
      {content}
    </section>
  )
}
