import { useId } from 'react'
import AccessibleDialog from './AccessibleDialog'
import PlanProgressBar from './PlanProgressBar'
import { formatFullDate } from '../lib/dates'

const STATUS_ORDER = { accepted: 0, pending: 1, declined: 2, revoked: 3 }

// The people a plan's owner has invited, each with where their invitation
// stands and, once they've accepted, how far through their own copy they are.
// Inviting more people starts from here.
export default function PlanMembersDialog({ planTitle, members, loading, error, onClose, onInvite, t }) {
  const titleId = useId()
  const descriptionId = useId()
  const sorted = [...members].sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.recipient_name.localeCompare(b.recipient_name))

  return (
    <AccessibleDialog
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onClose}
      panelClassName="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border border-hairline bg-card shadow-xl"
    >
      <div className="flex max-h-[90vh] flex-col">
        <div className="border-b border-hairline px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="font-display text-xl text-ink">{t('plans.membersTitle')}</h2>
              <p id={descriptionId} className="mt-1 text-sm text-secondary">{t('plans.membersDescription', { title: planTitle })}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={t('plans.closeMembers')} className="-mr-1 rounded-md p-1.5 text-secondary hover:bg-paper hover:text-ink">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {loading && members.length === 0 && !error ? (
            <p className="py-8 text-center text-sm text-secondary">{t('plans.loadingMembers')}</p>
          ) : members.length === 0 && !error ? (
            <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-sm text-secondary">{t('plans.noMembers')}</p>
          ) : (
            <ul className="space-y-2" aria-label={t('plans.membersTitle')}>
              {sorted.map((member) => <MemberRow key={member.invitation_id} member={member} t={t} />)}
            </ul>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-4">
          <p className="text-xs text-secondary">{t('plans.membersSharedNote')}</p>
          <button type="button" onClick={onInvite} className="shrink-0 rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper hover:opacity-90">
            {t('plans.invitePeople')}
          </button>
        </div>
      </div>
    </AccessibleDialog>
  )
}

function MemberRow({ member, t }) {
  // Progress is only shared while they're connected and still have the plan.
  const disconnected = member.status === 'accepted' && !member.plan_removed && member.connected === false
  const following = member.status === 'accepted' && !member.plan_removed && !disconnected
  const hasProgress = following && member.progress_total != null
  const percent = hasProgress && member.progress_total > 0
    ? Math.round((member.progress_done / member.progress_total) * 100)
    : 0
  const statusKey = member.plan_removed ? 'removed' : disconnected ? 'disconnected' : member.status
  const statusLabel = t(`plans.memberStatus.${statusKey}`)

  return (
    <li className="rounded-lg border border-hairline px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-ink">{member.recipient_name}</span>
        <span data-member-status={statusKey} className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${following ? 'bg-moss/15 text-moss' : 'border border-hairline text-secondary'}`}>
          {statusLabel}
        </span>
      </div>
      {following && (hasProgress ? (
        <div className="mt-2">
          <PlanProgressBar percent={percent} label={t('plans.memberProgressLabel', { name: member.recipient_name })} />
          <p className="mt-1 flex justify-between gap-3 text-xs text-secondary">
            <span>{t('plans.memberProgress', { done: member.progress_done, total: member.progress_total, percent })}</span>
            <span>{t('plans.memberProgressUpdated', { date: formatFullDate(member.progress_updated_at) })}</span>
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-secondary">{t('plans.memberNoProgressYet')}</p>
      ))}
      {member.status === 'pending' && (
        <p className="mt-1 text-xs text-secondary">{t('plans.memberInvitedOn', { date: formatFullDate(member.invited_at) })}</p>
      )}
    </li>
  )
}
