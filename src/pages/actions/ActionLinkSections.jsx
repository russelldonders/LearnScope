import { Link } from 'react-router-dom'
import { useLanguage } from '../../context/LanguageContext'
import { LEVEL_LABELS } from '../../lib/levels'
import { formatRelativeDate, formatAbsoluteDate } from '../../lib/dates'

// Invitations to rate a connection's skill.
export function RateInvitesSection({
  incomingRateInvites,
}) {
  const { t } = useLanguage()

  return (
    <div>
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.invitationsToRate')}</h2>
      <div className="space-y-3">
        {incomingRateInvites.map((invite) => (
          <Link
            key={invite.id}
            to={`/rate/${invite.share_code}`}
            className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
          >
            <p className="text-sm text-ink">
              <strong>{invite.inviter_name || 'Someone'}</strong> wants your rating on their skill:{' '}
              <strong>{invite.skill_name}</strong>
              {invite.skill_category ? ` (${invite.skill_category})` : ''}
            </p>
            <p className="font-mono text-xs text-secondary mt-0.5">
              {new Date(invite.created_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}

// Skills someone recommends the learner starts tracking.
export function RecommendInvitesSection({
  incomingRecommendInvites,
}) {
  const { t } = useLanguage()

  return (
    <div>
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.skillRecommendations')}</h2>
      <div className="space-y-3">
        {incomingRecommendInvites.map((invite) => (
          <Link
            key={invite.id}
            to={`/recommend/${invite.share_code}`}
            className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
          >
            <p className="text-sm text-ink">
              <strong>{invite.inviter_name || 'Someone'}</strong> recommends you start tracking:{' '}
              <strong>{invite.skill_name}</strong>
              {invite.skill_category ? ` (${invite.skill_category})` : ''}
            </p>
            <p className="font-mono text-xs text-secondary mt-0.5">
              {new Date(invite.created_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}

// Requests to confirm a connection has reached a level.
export function ValidationRequestsSection({
  profiles,
  validationRequests,
}) {
  const { t } = useLanguage()

  return (
    <div>
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.requestsToValidate')}</h2>
      <div className="space-y-3">
        {validationRequests.map((request) => (
          <Link
            key={request.id}
            to={`/validate-request/${request.id}`}
            className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
          >
            <p className="text-sm text-ink">
              <strong>{profiles[request.requester_id]?.name || 'Someone'}</strong> asked you to confirm{' '}
              they've reached <strong>{LEVEL_LABELS[request.target_level]}</strong> on{' '}
              <strong>{request.skills?.name}</strong>
            </p>
            <p className="font-mono text-xs text-secondary mt-0.5">
              {new Date(request.created_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}

// Ratings received since the learner last looked.
export function RatingsReceivedSection({
  unseenRatings,
}) {
  const { t } = useLanguage()

  return (
    <div>
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.ratingsReceived')}</h2>
      <div className="space-y-3">
        {unseenRatings.map((rating) => (
          <Link
            key={rating.id}
            to={`/skills/${rating.skill_id}`}
            className="block bg-card border border-hairline rounded-lg p-4 hover:border-moss/60 transition-colors"
          >
            <p className="text-sm text-ink">
              <strong>{rating.rater_name || 'A connection'}</strong> rated your skill{' '}
              <strong>{rating.skill_name}</strong>: {LEVEL_LABELS[rating.level]}
            </p>
            {rating.comments && <p className="text-sm text-secondary mt-1">{rating.comments}</p>}
            <p className="font-mono text-xs text-secondary mt-1" title={formatAbsoluteDate(rating.rated_at)}>
              {formatRelativeDate(rating.rated_at)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
