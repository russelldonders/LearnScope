import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { fetchConnectorContributions } from '../lib/connectorContributions'
import { formatMinutes } from '../lib/xapiStatement'
import { formatFullDate } from '../lib/dates'

// Shown under a connected app's card: which skills its synced activities
// count toward, with those activities listed under each skill. `refreshKey`
// changes after an import so the list picks up what was just added.
export default function ConnectorContributions({ source, refreshKey }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    fetchConnectorContributions(user.id, source)
      .then((result) => {
        if (live) {
          setGroups(result)
          setError(null)
        }
      })
      .catch((err) => {
        if (live) setError(err.message)
      })
    return () => {
      live = false
    }
  }, [user.id, source, refreshKey])

  if (error) return <p role="alert" className="text-sm text-red-700 mt-4">{error}</p>
  if (groups === null || groups.length === 0) return null

  return (
    <div className="mt-5 pt-4 border-t border-hairline">
      <h4 className="text-sm font-medium text-ink">{t('connectedAccounts.contributions.heading')}</h4>
      <p className="text-xs text-secondary mt-0.5 mb-2">{t('connectedAccounts.contributions.description')}</p>
      <ul className="space-y-2">
        {groups.map((group) => {
          const count = group.activities.length
          const time = formatMinutes(group.totalMinutes)
          return (
            <li key={group.skillId}>
              <details className="rounded-md border border-hairline bg-paper">
                <summary className="cursor-pointer px-3 py-2 text-sm flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{group.skillName}</span>
                  <span className="text-secondary">
                    {t(
                      count === 1
                        ? 'connectedAccounts.contributions.activitySingular'
                        : 'connectedAccounts.contributions.activityPlural',
                      { count },
                    )}
                    {time ? ` · ${time}` : ''}
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <ul className="max-h-64 overflow-y-auto divide-y divide-hairline">
                    {group.activities.map((activity) => (
                      <li key={activity.id} className="flex flex-wrap justify-between gap-x-3 py-1.5 text-sm">
                        <span className="text-ink">{activity.name}</span>
                        <span className="text-secondary">
                          {formatFullDate(activity.recordedAt)}
                          {activity.minutes ? ` · ${formatMinutes(activity.minutes)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link to={`/skills/${group.skillId}`} className="inline-block mt-2 text-sm text-moss hover:underline">
                    {t('connectedAccounts.contributions.viewSkill', { skill: group.skillName })}
                  </Link>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
