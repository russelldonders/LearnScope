import { useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { xapiActivityId } from '../lib/courseContent'
import { listMyPackageStatements, packageActivityOverview } from '../lib/skillResources'

// A package's verb in words: its own display text, else the end of its IRI
// ("…/verbs/passed" -> "Passed").
export function packageVerbText(statement) {
  const display = statement?.verb?.display
  const shown = display && (display['en-US'] ?? display['en-GB'] ?? display.en ?? Object.values(display)[0])
  if (typeof shown === 'string' && shown.trim()) return shown.trim()
  const word = String(statement?.verb?.id ?? '').split(/[/#]/).filter(Boolean).pop() ?? ''
  return word ? word[0].toUpperCase() + word.slice(1).replace(/[-_]/g, ' ') : '—'
}

// What it was about: the object's own name, else the package itself when it
// was the package launched, else nothing.
export function packageObjectText(statement, resource) {
  const names = statement?.object?.definition?.name
  const named = names && (names['en-US'] ?? names['en-GB'] ?? names.en ?? Object.values(names)[0])
  if (typeof named === 'string' && named.trim()) return named.trim()
  return statement?.object?.id === xapiActivityId(resource) ? resource.title : null
}

// The learner's own activity in an xAPI package resource (0316), on the
// resource itself: how often they've opened it, when last, how they did and
// what they earned -- and, opened up, each session and everything the
// package recorded. Only ever their own, on their packages and shared ones.
export default function PackageActivity({ resource, sessions, userId }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [statements, setStatements] = useState(null)
  const [error, setError] = useState(null)
  const overview = packageActivityOverview(sessions)
  if (!overview) return null
  const k = (key, params) => t(`skillDetail.resources.packageActivity.${key}`, params)
  const outcomeLabel = (outcome) => (outcome ? k(`outcome${outcome[0].toUpperCase()}${outcome.slice(1)}`) : null)
  const listId = `package-activity-${resource.id}`

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && statements === null) {
      try {
        setStatements(await listMyPackageStatements(userId, resource.id))
      } catch (err) {
        setError(err.message)
      }
    }
  }

  const summary = [
    overview.count === 1 ? k('openedOnce') : k('openedCount', { count: overview.count }),
    k('lastOpened', { date: formatFullDate(overview.lastOpenedAt) }),
    outcomeLabel(overview.outcome),
    overview.earned.length ? k('earnedCount', { count: overview.earned.length }) : null,
  ].filter(Boolean)

  return (
    <div data-package-activity="" className="mt-2 rounded-md bg-paper px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-ink">{summary.join(' · ')}</p>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={listId}
          className="text-xs font-medium text-moss hover:underline"
        >
          {open ? k('hideActivity') : k('showActivity')}
        </button>
      </div>
      {overview.earned.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={k('earnedCount', { count: overview.earned.length })}>
          {overview.earned.map((name) => (
            <li key={name} className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] text-ink">{name}</li>
          ))}
        </ul>
      )}
      {open && (
        <div id={listId} className="mt-3 space-y-3">
          <div>
            <h4 className="font-mono text-[10px] uppercase tracking-wide text-secondary">{k('sessionsHeading')}</h4>
            <ul className="mt-1 space-y-0.5">
              {sessions.map((session) => (
                <li key={session.id} className="text-xs text-ink">
                  {[
                    formatFullDate(session.openedAt),
                    session.minutes ? k('sessionMinutes', { minutes: session.minutes }) : null,
                    outcomeLabel(session.outcome),
                    session.earned.length ? k('earnedCount', { count: session.earned.length }) : null,
                  ].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-mono text-[10px] uppercase tracking-wide text-secondary">{k('recordedHeading')}</h4>
            {error ? (
              <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>
            ) : statements === null ? (
              <p className="mt-1 text-xs text-secondary">{t('skillDetail.resources.loading')}</p>
            ) : statements.length === 0 ? (
              <p className="mt-1 text-xs text-secondary">{k('nothingRecorded')}</p>
            ) : (
              <ul className="mt-1 max-h-64 space-y-0.5 overflow-y-auto">
                {statements.map((row) => (
                  <li key={row.id} className="text-xs text-secondary">
                    <span className="text-ink">{packageVerbText(row.statement)}</span>
                    {[
                      packageObjectText(row.statement, resource),
                      new Date(row.recorded_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
                    ].filter(Boolean).map((part) => ` · ${part}`).join('')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
