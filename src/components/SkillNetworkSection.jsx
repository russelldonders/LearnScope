import { Link } from 'react-router-dom'
import PersonAvatar from './PersonAvatar'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'

// Who else is involved with a skill, styled like the Goals section above it,
// in two parts:
//   1. Recommending -- your connections who have the skill, and who you've
//      recommended it to.
//   2. Beyond your connections -- how many people have it (information only,
//      no names), and Find an expert among those who chose to be findable.
// Without a librarySkillId the skill can't be matched to anyone else's, so
// there's nothing to show. Ratings from others live in the skill's Validate
// box (RatingsFromOthers below).
export default function SkillNetworkSection({
  skillName,
  librarySkillId,
  isOwner,
  recommendInvites = [],
  recommendAcceptors = {},
  knownPeople = {},
  connections,
  totalTrackersCount,
  onFindExpert,
  onRecommend,
}) {
  const { t } = useLanguage()
  const recommendedWaiting = recommendInvites.filter((invite) => invite.status === 'pending' && invite.invitee_email)
  const recommendedAccepted = recommendInvites.filter((invite) => invite.status === 'accepted')
  const { known, nameFor } = peopleByEmail(knownPeople)
  if (!librarySkillId) return null

  return (
    // The skill's Network tab already says what this is, so no box around the
    // parts: each is a top-level card like Goals and Learning.
    <section aria-labelledby="skill-network-heading">
      <h2 id="skill-network-heading" className="sr-only">{t('skillDetail.skillNetwork')}</h2>

      <div>
        {librarySkillId && (
          <Part
            id="skill-network-recommend"
            title={t('skillDetail.network.recommendTitle')}
            description={t('skillDetail.network.recommendDescription')}
            action={{ label: t('skillDetail.network.recommendToSomeoneNew', { skill: skillName }), onClick: onRecommend }}
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
                      name={person?.name || (invite.invitee_email ? nameFor(invite.invitee_email) : t('skillDetail.network.someone'))}
                      avatarUrl={person?.avatarUrl ?? known(invite.invitee_email)?.avatarUrl ?? null}
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
                    name={nameFor(invite.invitee_email)}
                    avatarUrl={known(invite.invitee_email)?.avatarUrl ?? null}
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

// An invite only stores the address it went to. knownPeople (lower-cased
// email -> { name, avatarUrl }) names the ones that belong to a connection;
// anyone else has no name in LearnScope yet, so their address stands in.
function peopleByEmail(knownPeople) {
  const known = (email) => knownPeople[email?.toLowerCase()] ?? null
  return { known, nameFor: (email) => known(email)?.name || email }
}

// Who has rated the learner on this skill and who they've asked and are
// still waiting on -- shown in the skill's Validate box, below its "Ask
// someone to rate your ability" button. Share links have no one's email on
// them, so only invites sent to someone are listed; once accepted, a rate
// invite shows as the rating itself.
export function RatingsFromOthers({ ratings = [], raterAvatars = {}, rateInvites = [], knownPeople = {} }) {
  const { t } = useLanguage()
  const { known, nameFor } = peopleByEmail(knownPeople)
  const waitingForRating = rateInvites.filter((invite) => invite.status === 'pending' && invite.invitee_email)
  if (ratings.length === 0 && waitingForRating.length === 0) return <Empty>{t('skillDetail.network.noRatingsYet')}</Empty>
  return (
    <div className="space-y-3">
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
              name={nameFor(invite.invitee_email)}
              avatarUrl={known(invite.invitee_email)?.avatarUrl ?? null}
              detail={t('skillDetail.network.askedOn', { date: formatFullDate(invite.created_at) })}
            />
          ))}
        </PeopleList>
      )}
    </div>
  )
}

// One of the parts, as a section card styled like Goals and Learning: title
// and one-line explanation with its action beside them, then what's
// happened so far.
function Part({ id, title, description, action, children }) {
  return (
    <section aria-labelledby={id} className="mt-4 rounded-md border border-hairline bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 id={id} className="font-display text-xl text-ink">{title}</h3>
          <p className="text-xs text-secondary">{description}</p>
        </div>
        {action?.onClick && (
          <button
            type="button"
            onClick={action.onClick}
            className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
          >
            {action.label}
          </button>
        )}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function PeopleList({ heading, children }) {
  return (
    <div>
      <p className="text-xs text-secondary mb-1">{heading}</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">{children}</ul>
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
  const className = 'flex items-center gap-2 py-1 min-w-0'
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
