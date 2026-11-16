import { useId, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import PlanProgressBar from './PlanProgressBar'
import { formatFullDate } from '../lib/dates'

// Owners first (the creator leading), then followers, then invitations.
function rank(row) {
  if (row.status !== 'member') return 3
  if (row.is_creator) return 0
  return row.role === 'owner' ? 1 : 2
}

// For a plan's owners: everyone on the plan, with their role and how far
// through it they are, and the invitations not (or no longer) matched by
// someone on it. Owners make others co-owners (or followers again) and
// withdraw invitations still waiting; inviting more people starts here.
export default function PlanMembersDialog({ planTitle, members, loading, error, currentUserId, onClose, onInvite, onWithdraw, onSetRole, onRemove, t }) {
  const titleId = useId()
  const descriptionId = useId()
  const sorted = [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))

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
          ) : members.length <= 1 && !error ? (
            <>
              {sorted.length > 0 && (
                <ul className="mb-3 space-y-2" aria-label={t('plans.membersTitle')}>
                  {sorted.map((row) => <MemberRow key={row.user_id ?? row.invitation_id} row={row} currentUserId={currentUserId} onWithdraw={onWithdraw} onSetRole={onSetRole} onRemove={onRemove} t={t} />)}
                </ul>
              )}
              <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-sm text-secondary">{t('plans.noMembers')}</p>
            </>
          ) : (
            <ul className="space-y-2" aria-label={t('plans.membersTitle')}>
              {sorted.map((row) => <MemberRow key={row.user_id ?? row.invitation_id} row={row} currentUserId={currentUserId} onWithdraw={onWithdraw} onSetRole={onSetRole} onRemove={onRemove} t={t} />)}
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

function MemberRow({ row, currentUserId, onWithdraw, onSetRole, onRemove, t }) {
  const [working, setWorking] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const isMember = row.status === 'member'
  const hasProgress = isMember && row.progress_total != null
  const percent = hasProgress && row.progress_total > 0
    ? Math.round((row.progress_done / row.progress_total) * 100)
    : 0
  const badge = isMember
    ? row.is_creator ? t('plans.roleCreator') : row.role === 'owner' ? t('plans.roleOwner') : t('plans.roleFollower')
    : t(`plans.memberStatus.${row.status}`)
  const canChangeRole = isMember && !row.is_creator && row.user_id !== currentUserId && onSetRole

  async function act(action) {
    setWorking(true)
    try { await action() } finally { setWorking(false) }
  }

  return (
    <li className="rounded-lg border border-hairline px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-ink">
          {row.name}
          {row.user_id === currentUserId && <span className="font-normal text-secondary"> {t('plans.memberYou')}</span>}
        </span>
        <span data-member-status={isMember ? row.role : row.status} className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${isMember && row.role === 'owner' ? 'bg-gold/15 text-gold' : isMember ? 'bg-moss/15 text-moss' : 'border border-hairline text-secondary'}`}>
          {badge}
        </span>
      </div>
      {isMember && (hasProgress ? (
        <div className="mt-2">
          <PlanProgressBar percent={percent} label={t('plans.memberProgressLabel', { name: row.name })} />
          <p className="mt-1 flex justify-between gap-3 text-xs text-secondary">
            <span>{t('plans.memberProgress', { done: row.progress_done, total: row.progress_total, percent })}</span>
            <span>{t('plans.memberProgressUpdated', { date: formatFullDate(row.progress_updated_at) })}</span>
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-secondary">{t('plans.memberNoProgressYet')}</p>
      ))}
      {isMember && row.via === 'link' && (
        <p className="mt-1 text-xs text-secondary">{t('plans.memberJoinedWithLink')}</p>
      )}
      {canChangeRole && (confirmingRemove ? (
        <div role="group" aria-label={t('plans.removeFromPlanFor', { name: row.name })} className="mt-2 rounded-md border border-hairline bg-paper p-3 text-xs">
          <p className="text-ink">{t('plans.removeFromPlanConfirm', { name: row.name })}</p>
          <div className="mt-2 flex gap-3">
            <button type="button" disabled={working} onClick={() => act(() => onRemove(row))} className="font-medium text-red-700 hover:underline disabled:opacity-50">
              {t('plans.removeFromPlan')}
            </button>
            <button type="button" disabled={working} onClick={() => setConfirmingRemove(false)} className="text-secondary hover:text-ink">
              {t('plans.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <button
            type="button"
            disabled={working}
            aria-label={t(row.role === 'owner' ? 'plans.makeFollowerFor' : 'plans.makeCoOwnerFor', { name: row.name })}
            onClick={() => act(() => onSetRole(row, row.role === 'owner' ? 'follower' : 'owner'))}
            className="font-medium text-moss hover:underline disabled:opacity-50"
          >
            {row.role === 'owner' ? t('plans.makeFollower') : t('plans.makeCoOwner')}
          </button>
          {onRemove && (
            <button
              type="button"
              disabled={working}
              aria-label={t('plans.removeFromPlanFor', { name: row.name })}
              onClick={() => setConfirmingRemove(true)}
              className="font-medium text-red-700 hover:underline disabled:opacity-50"
            >
              {t('plans.removeFromPlan')}
            </button>
          )}
        </div>
      ))}
      {row.status === 'pending' && (
        <div className="mt-1 flex items-center justify-between gap-3 text-xs">
          <p className="text-secondary">
            {t(row.via === 'email' ? 'plans.memberEmailedOn' : 'plans.memberInvitedOn', { date: formatFullDate(row.invited_at) })}
          </p>
          {onWithdraw && (
            <button
              type="button"
              disabled={working}
              aria-label={t('plans.withdrawInvitationFor', { name: row.name })}
              onClick={() => act(() => onWithdraw(row))}
              className="shrink-0 font-medium text-red-700 hover:underline disabled:opacity-50"
            >
              {t('plans.withdrawInvitation')}
            </button>
          )}
        </div>
      )}
    </li>
  )
}
