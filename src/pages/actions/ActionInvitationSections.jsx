import { Link } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import ManagerTeamInviteCard from '../manager/learner/ManagerTeamInviteCard'

// Invitations to follow someone else's plan.
export function PlanInvitationsSection({
  handlePlanInviteResponse,
  planInviteDecidingId,
  planInviteError,
  planInvites,
}) {
  const { t } = useLanguage()

  return (
    <section id="plan-invitations" aria-labelledby="plan-invitations-heading">
      <h2 id="plan-invitations-heading" className="mb-6 font-display text-xl text-ink">{t('actions.planInvitations')}</h2>
      <div className="space-y-3">
        {planInvites.map((invite) => (
          <div key={invite.id} className="rounded-lg border border-hairline bg-card p-4">
            <p className="text-sm text-ink">
              <strong>{invite.inviter_name}</strong>{' '}
              {t('actions.invitedToFollowPlan')}{' '}
              <strong>{invite.plan_title}</strong>
            </p>
            {invite.plan_description && <p className="mt-1 text-sm text-secondary">{invite.plan_description}</p>}
            <p className="mt-2 text-xs text-secondary">{t('actions.planInvitePrivateCopy')}</p>
            <p className="mt-1 font-mono text-xs text-secondary">{new Date(invite.created_at).toLocaleDateString()}</p>
            {planInviteError?.id === invite.id && <p className="mt-2 text-xs text-red-700">{planInviteError.message}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handlePlanInviteResponse(invite, true)}
                disabled={planInviteDecidingId === invite.id}
                className="rounded-md bg-moss px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-60"
              >
                {t('actions.acceptPlanInvite')}
              </button>
              <button
                type="button"
                onClick={() => handlePlanInviteResponse(invite, false)}
                disabled={planInviteDecidingId === invite.id}
                className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60"
              >
                {t('actions.declinePlanInvite')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// Requests to connect, optionally over a skill.
export function ConnectionRequestsSection({
  connectionRequests,
  handleRequestResponse,
  profiles,
  respondError,
  respondingId,
}) {
  const { t } = useLanguage()

  return (
    <div id="connection-requests">
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.connectionRequests')}</h2>
      <div className="space-y-3">
        {connectionRequests.map((request) => (
          <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
            <p className="text-sm text-ink">
              <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong>
              {request.skills?.name ? (
                <>
                  {' '}wants to connect over <strong>{request.skills.name}</strong>
                </>
              ) : (
                ' wants to connect'
              )}
            </p>
            {request.message && <p className="text-sm text-secondary mt-1">{request.message}</p>}
            <p className="font-mono text-xs text-secondary mt-1">
              {new Date(request.created_at).toLocaleDateString()}
            </p>
            {respondError?.id === request.id && (
              <p className="text-xs text-red-700 mt-1">{respondError.message}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => handleRequestResponse(request.id, true)}
                disabled={respondingId === request.id}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => handleRequestResponse(request.id, false)}
                disabled={respondingId === request.id}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Requests to see some of the learner's skills.
export function SkillAccessRequestsSection({
  handleRequestResponse,
  profiles,
  respondError,
  respondingId,
  skillAccessRequests,
}) {
  const { t } = useLanguage()

  return (
    <div>
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.skillAccessRequests')}</h2>
      <div className="space-y-3">
        {skillAccessRequests.map((request) => (
          <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
            <p className="text-sm text-ink">
              <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong> would like you to
              consider sharing some of your skills with them.
            </p>
            {request.message && <p className="text-sm text-secondary mt-1">{request.message}</p>}
            <p className="font-mono text-xs text-secondary mt-1">
              {new Date(request.created_at).toLocaleDateString()}
            </p>
            {respondError?.id === request.id && (
              <p className="text-xs text-red-700 mt-1">{respondError.message}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <Link
                to="/profile/privacy"
                onClick={() => handleRequestResponse(request.id, true)}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
              >
                Manage sharing
              </Link>
              <button
                type="button"
                onClick={() => handleRequestResponse(request.id, false)}
                disabled={respondingId === request.id}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Invitations to join a training provider as an admin or trainer.
export function ProviderInvitationsSection({
  handleOrgInviteResponse,
  orgInviteDecidingId,
  orgInviteError,
  orgInvites,
}) {
  const { t } = useLanguage()

  return (
    <div id="provider-invitations">
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.providerInvitations')}</h2>
      <div className="space-y-3">
        {orgInvites.map((invite) => (
          <div key={invite.id} className="bg-card border border-hairline rounded-lg p-4">
            <p className="text-sm text-ink">
              <strong>{invite.organisations?.name || 'A provider organisation'}</strong> wants to add you as{' '}
              {invite.role === 'admin' ? 'an admin' : 'a trainer'}
            </p>
            <p className="font-mono text-xs text-secondary mt-1">
              {new Date(invite.created_at).toLocaleDateString()}
            </p>
            {orgInviteError?.id === invite.id && (
              <p className="text-xs text-red-700 mt-1">{orgInviteError.message}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => handleOrgInviteResponse(invite.id, true)}
                disabled={orgInviteDecidingId === invite.id}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => handleOrgInviteResponse(invite.id, false)}
                disabled={orgInviteDecidingId === invite.id}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Invitations to join an employer as an admin or member.
export function EmployerInvitationsSection({
  employerInviteDecidingId,
  employerInviteError,
  employerInvites,
  handleEmployerInviteResponse,
}) {
  const { t } = useLanguage()

  return (
    <div id="employer-invitations">
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.employerInvitations')}</h2>
      <div className="space-y-3">
        {employerInvites.map((invite) => (
          <div key={invite.id} className="bg-card border border-hairline rounded-lg p-4">
            <p className="text-sm text-ink">
              <strong>{invite.employers?.name || 'An employer'}</strong> wants to add you as{' '}
              {invite.role === 'admin' ? 'an admin' : 'a member'}
            </p>
            <p className="font-mono text-xs text-secondary mt-1">
              {new Date(invite.created_at).toLocaleDateString()}
            </p>
            {employerInviteError?.id === invite.id && (
              <p className="text-xs text-red-700 mt-1">{employerInviteError.message}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => handleEmployerInviteResponse(invite.id, true)}
                disabled={employerInviteDecidingId === invite.id}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => handleEmployerInviteResponse(invite.id, false)}
                disabled={employerInviteDecidingId === invite.id}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Invitations to join a team leader's team.
export function ManagerTeamInvitationsSection({
  handleManagerTeamInviteResponse,
  managerInviteDecidingId,
  managerInviteError,
  managerTeamInvites,
}) {
  const { t } = useLanguage()

  return (
    <section id="manager-team-invitations" aria-labelledby="manager-team-invitations-heading">
      <h2 id="manager-team-invitations-heading" className="font-display text-xl text-ink mb-6">
        {t('actions.managerTeamInvitations')}
      </h2>
      <div className="space-y-3">
        {managerTeamInvites.map((invite) => (
          <ManagerTeamInviteCard
            key={invite.id}
            invite={invite}
            submitting={managerInviteDecidingId === invite.id}
            error={managerInviteError?.id === invite.id ? managerInviteError.message : null}
            onAccept={() => handleManagerTeamInviteResponse(invite.id, true)}
            onDecline={() => handleManagerTeamInviteResponse(invite.id, false)}
          />
        ))}
      </div>
    </section>
  )
}
