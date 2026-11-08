import { useLanguage } from '../context/LanguageContext'
import { activityRhythm } from '../lib/activityRhythm'

// The last seven days as dots, plus a weekly streak. Weeks rather than days
// lead, so a rest day never "breaks" anything.
export default function ActivityRhythm({ days }) {
  const { t, language } = useLanguage()
  const rhythm = activityRhythm(days)
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'narrow' })
  const fullDay = new Intl.DateTimeFormat(language, { weekday: 'long', day: 'numeric', month: 'long' })
  const dateOf = (date) => new Date(`${date}T12:00:00`)

  let message
  if (rhythm.weekStreak === 0) message = t('quickLog.rhythm.start')
  else if (!rhythm.loggedThisWeek) message = t('quickLog.rhythm.keepGoing', { count: rhythm.weekStreak })
  else message = t('quickLog.rhythm.weekStreak', { count: rhythm.weekStreak })

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-hairline bg-card px-3 py-2">
      <ol aria-label={t('quickLog.rhythm.lastSeven', { count: rhythm.daysInLastSeven })} className="flex items-end gap-1.5">
        {rhythm.lastSeven.map((day) => (
          <li key={day.date} className="flex flex-col items-center gap-0.5">
            <span
              aria-hidden="true"
              className={`block h-3.5 w-3.5 rounded-full border ${
                day.logged ? 'border-moss bg-moss' : 'border-hairline bg-paper'
              } ${day.isToday ? 'ring-2 ring-moss/30 ring-offset-1 ring-offset-card' : ''}`}
            />
            <span aria-hidden="true" className={`font-mono text-[10px] ${day.isToday ? 'text-ink' : 'text-secondary'}`}>
              {weekday.format(dateOf(day.date))}
            </span>
            <span className="sr-only">
              {t(day.logged ? 'quickLog.rhythm.dayLogged' : 'quickLog.rhythm.dayEmpty', { day: fullDay.format(dateOf(day.date)) })}
            </span>
          </li>
        ))}
      </ol>
      <div className="min-w-0 text-sm">
        <p className="text-ink font-medium">{message}</p>
        <p className="text-xs text-secondary">
          {t('quickLog.rhythm.lastSeven', { count: rhythm.daysInLastSeven })}
          {rhythm.loggedToday && rhythm.dayStreak >= 2 && ` · ${t('quickLog.rhythm.dayStreak', { count: rhythm.dayStreak })}`}
        </p>
      </div>
    </div>
  )
}
