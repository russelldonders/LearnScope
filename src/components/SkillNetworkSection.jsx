import { Link } from 'react-router-dom'
import PersonAvatar from './PersonAvatar'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'

// Who else is involved with a skill, styled like the Goals section above it,
// in three parts:
//   1. Ratings -- asking people to rate you, with who's been asked and who has
//      rated (owner only: these are the owner's own invites and ratings).
//   2. Recommending -- your connections who have the skill, and who you've
//      recommended it to.
//   3. Beyond your connections -- how many people have it (information only,
//      no names), and Find an expert among those who chose to be findable.
// Without a librarySkillId the skill can't be matched to anyone else's, so
// parts 2 and 3 have nothing to show.
export default function SkillNetworkSection({
  skillName,
  librarySkillId,
  isOwner,
  ratings = [],
  raterAvatars = {},
  rateInvites = [],
  recommendInvites = [],
  recommendAcceptors = {},
  connections,
  totalTrackersCount,
  onInviteToRate,
  onFindExpert,
  onRecommend,
}) {
  const { t } = useLanguage()
  // Share links have no one's email on them, so only invites sent to someone
  // are listed; once accepted, a rate invite shows as the rating itself.
  const waitingForRating = rateInvites.filter((invite) => invite.status === 'pending' && invite.invitee_email)
  const recommendedWaiting = recommendInvites.filter((invite) => invite.status === 'pending' && invite.invitee_email)
  const recommendedAccepted = recommendInvites.filter((invite) => invite.status === 'accepted')

  return (
    <section aria-labelledby="skill-network-heading" className="mt-4 rounded-md border border-hairline bg-paper p-4">
      <h2 id="skill-network-heading" className="font-display text-xl text-ink">{t('skillDetail.skillNetwork')}</h2>

      <div className="space-y-3 mt-3">
        {isOwner && (
          <Part
            id="skill-network-ratings"
            title={t('skillDetail.network.ratingsTitle')}
            description={t('skillDetail.network.ratingsDescription')}
            action={{ label: t('skillDetail.network.askToRate', { skill: skillName }), onClick: onInviteToRate, primary: true }}
          >
            {ratings.length === 0 && waitingForRating.length === 0 ? (
              <Empty>{t('skillDetail.network.noRatingsYet')}</Empty>
            ) : (
              <>
                {ratings.length > 0 && (
                  <PeopleList heading={t('skillDetail.network.rated')}>
                    {ratings.map((rating) => (
                      <Person
                        key={rating.id}
                        name={rating.rater_name || rating.rater_email}
                        avatarUrl={raterAvatars[rating.rater_id] ?? null}
                        detail={`${LEVEL_LABELS[rating.level] ?? ''} · ${formatFullDate(rating.rated_at)}`}
                      />
                    ))}
                  </PeopleList>
                )}
                {waitingForRating.length > 0 && (
                  <PeopleList heading={t('skillDetail.network.waitingForRating')}>
                    {waitingForRating.map((invite) => (
                      <Person
                        key={invite.id}
                        name={invite.invitee_email}
                        detail={t('skillDetail.network.askedOn', { date: formatFullDate(invite.created_at) })}
                      />
                    ))}
                  </PeopleList>
                )}
              </>
            )}
          </Part>
        )}

        {librarySkillId && (
          <Part
            id="skill-network-recommend"
            title={t('skillDetail.network.recommendTitle')}
            description={t('skillDetail.network.recommendDescription')}
            action={{ label: t('skillDetail.recommendThisSkill'), onClick: onRecommend }}
          >
            <PeopleList heading={t('skillDetail.network.connectionsWithSkill')}>
              {connections.length === 0 ? (
                <Empty as="li">{t('skillDetail.noConnectionsTrackSkill')}</Empty>
              ) : (
                connections.map((connection) => (
                  <Person
                    key={connection.id}
                    name={connection.name}
                    avatarUrl={connection.avatarUrl}
                    to={`/skills-profile/${connection.id}`}
                  />
                ))
              )}
            </PeopleList>
            {isOwner && recommendedAccepted.length > 0 && (
              <PeopleList heading={t('skillDetail.network.recommendationsAccepted')}>
                {recommendedAccepted.map((invite) => {
                  const person = recommendAcceptors[invite.accepted_by]
                  return (
                    <Person
                      key={invite.id}
                      name={person?.name || invite.invitee_email || t('skillDetail.network.someone')}
                      avatarUrl={person?.avatarUrl ?? null}
                      detail={formatFullDate(invite.accepted_at)}
                    />
                  )
                })}
              </PeopleList>
            )}
            {isOwner && recommendedWaiting.length > 0 && (
              <PeopleList heading={t('skillDetail.network.recommendationsWaiting')}>
                {recommendedWaiting.map((invite) => (
                  <Person
                    key={invite.id}
                    name={invite.invitee_email}
                    detail={t('skillDetail.network.sentOn', { date: formatFullDate(invite.created_at) })}
                  />
                ))}
              </PeopleList>
            )}
          </Part>
        )}

        {librarySkillId && (
          <Part
            id="skill-network-wider"
            title={t('skillDetail.network.widerTitle')}
            description={t('skillDetail.network.widerDescription')}
            action={{ label: t('skillDetail.findAnExpert'), onClick: onFindExpert }}
          >
            <p className="flex items-center gap-1.5 text-sm text-ink">
              <PeopleIcon />
              {totalTrackersCount}{' '}
              {totalTrackersCount === 1 ? t('skillDetail.personSingular') : t('skillDetail.peoplePlural')}{' '}
              {t('skillDetail.inTotalHaveThisSkillSuffix')}
            </p>
          </Part>
        )}
      </div>
    </section>
  )
}

// One of the three parts: a card like a goal tile, its title and one-line
// explanation, the action for it, then what's happened so far.
function Part({ id, title, description, action, children }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-hairline bg-card p-4">
      <h3 id={id} className="text-sm font-medium text-ink">{title}</h3>
      <p className="text-xs text-secondary mt-0.5">{description}</p>
      <div className="mt-3 space-y-3">{children}</div>
      {action?.onClick && (
        <button
          type="button"
          onClick={action.onClick}
          className={
            action.primary
              ? 'mt-3 rounded-md border border-transparent bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90'
              : 'mt-3 rounded-md border border-hairline text-ink text-xs font-medium px-3 py-1.5 hover:border-moss'
          }
        >
          {action.label}
        </button>
      )}
    </section>
  )
}

function PeopleList({ heading, children }) {
  return (
    <div>
      <p className="text-xs text-secondary mb-1">{heading}</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</ul>
    </div>
  )
}

function Person({ name, avatarUrl = null, detail = null, to = null }) {
  const body = (
    <>
      <PersonAvatar name={name} avatarUrl={avatarUrl} size={6} />
      <span className="min-w-0">
        <span className={`block text-sm text-ink truncate ${to ? 'group-hover:text-moss group-hover:underline underline-offset-2' : ''}`}>
          {name}
        </span>
        {detail && <span className="block text-xs text-secondary truncate">{detail}</span>}
      </span>
    </>
  )
  const className = 'flex items-center gap-2 rounded-md border border-hairline bg-paper px-3 py-2 min-w-0'
  return (
    <li>
      {to ? (
        <Link to={to} className={`group ${className}`}>{body}</Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  )
}

function Empty({ children, as: Tag = 'p' }) {
  return <Tag className="text-sm text-secondary">{children}</Tag>
}

function PeopleIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
