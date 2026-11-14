import { Link } from 'react-router-dom'
import PersonAvatar from './PersonAvatar'
import { useLanguage } from '../context/LanguageContext'

// Who else is working on a skill, beside the goals and styled the same way.
// Connections are listed by name since they're people the learner knows; the
// wider count is information only -- no list of strangers' names behind it.
// librarySkillId: without one the skill can't be matched to anyone else's, so
// only the actions show.
export default function SkillNetworkSection({
  librarySkillId,
  connections,
  totalTrackersCount,
  onInviteToRate = null,
  onRecommend,
}) {
  const { t } = useLanguage()

  return (
    <section aria-labelledby="skill-network-heading" className="mt-4 rounded-md border border-hairline bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="skill-network-heading" className="font-display text-xl text-ink min-w-0">{t('skillDetail.skillNetwork')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {onInviteToRate && (
            <button
              type="button"
              onClick={onInviteToRate}
              className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
            >
              {t('skillDetail.inviteOthersToAssess')}
            </button>
          )}
          {librarySkillId && (
            <button
              type="button"
              onClick={onRecommend}
              className="rounded-md border border-hairline bg-card text-ink text-xs font-medium px-3 py-1.5 hover:border-moss"
            >
              {t('skillDetail.recommendThisSkill')}
            </button>
          )}
        </div>
      </div>

      {librarySkillId && (
        <>
          {connections.length > 0 ? (
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {connections.map((connection) => (
                <li key={connection.id}>
                  <Link
                    to={`/skills-profile/${connection.id}`}
                    className="group flex items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2 min-w-0"
                  >
                    <PersonAvatar name={connection.name} avatarUrl={connection.avatarUrl} size={6} />
                    <span className="text-sm text-ink truncate group-hover:text-moss group-hover:underline underline-offset-2">
                      {connection.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary mt-3">{t('skillDetail.noConnectionsTrackSkill')}</p>
          )}

          <p className="flex items-center gap-1.5 text-xs text-secondary mt-3">
            <PeopleIcon />
            {totalTrackersCount}{' '}
            {totalTrackersCount === 1 ? t('skillDetail.personSingular') : t('skillDetail.peoplePlural')}{' '}
            {t('skillDetail.inTotalHaveThisSkillSuffix')}
          </p>
        </>
      )}
    </section>
  )
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
