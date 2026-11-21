import { useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { xapiActivityId } from '../lib/courseContent'
import { listMyPackageStatements } from '../lib/skillResources'
import { PackageSessions } from './ActivityTimeline'

// A package's verb in words: its own display text, else the end of its IRI
// ("…/verbs/passed" -> "Passed").
function packageVerbText(statement) {
  const display = statement?.verb?.display
  const shown = display && (display['en-US'] ?? display['en-GB'] ?? display.en ?? Object.values(display)[0])
  if (typeof shown === 'string' && shown.trim()) return shown.trim()
  const word = String(statement?.verb?.id ?? '').split(/[/#]/).filter(Boolean).pop() ?? ''
  return word ? word[0].toUpperCase() + word.slice(1).replace(/[-_]/g, ' ') : '—'
}

// What it was about: the object's own name, else the package itself when it
// was the package launched, else nothing.
function packageObjectText(statement, resource) {
  const names = statement?.object?.definition?.name
  const named = names && (names['en-US'] ?? names['en-GB'] ?? names.en ?? Object.values(names)[0])
  if (typeof named === 'string' && named.trim()) return named.trim()
  return statement?.object?.id === xapiActivityId(resource) ? resource.title : null
}

// The learner's own activity in an xAPI package resource (0316), on the
// resource itself, drawn exactly as the timeline draws a package's sessions
// (PackageSessions): what was achieved first -- best outcome and score, the
// stamps and badges earned -- then how many sessions and when last, opening
// to each session and to everything the package recorded. Only ever their
// own, on their packages and shared ones. sessions: their session rows for
// this resource (listMyPackageSessions).
export default function PackageActivity({ resource, sessions, userId }) {
  const { t } = useLanguage()
  const [statements, setStatements] = useState(null)
  const [error, setError] = useState(null)
  if (!sessions?.length) return null
  const k = (key, params) => t(`skillDetail.resources.packageActivity.${key}`, params)

  async function loadStatements(open) {
    if (!open || statements !== null) return
    try {
      setStatements(await listMyPackageStatements(userId, resource.id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div data-package-activity="" className="mt-2 rounded-md bg-paper px-3 py-2">
      <PackageSessions rows={sessions} dated titled={false} showSkills={false} sessionDates onOpenChange={loadStatements}>
        <div className="mt-3">
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
      </PackageSessions>
    </div>
  )
}
