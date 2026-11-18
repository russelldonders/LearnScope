import { useEffect, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import { useLanguage } from '../context/LanguageContext'
import { buildAdlLaunchUrl } from '../lib/adlLaunch'
import { fetchShimmedLaunchDoc, xapiActivityId } from '../lib/courseContent'
import { createSkillPackageLaunchSession, packageLaunchUrl } from '../lib/skillResources'

// A SCORM or xAPI package on a skill, opened over almost the whole screen.
//
// Both play in a sandboxed frame with no allow-same-origin, for the same
// reasons as ScormPlayer.jsx and XapiPlayer.jsx: the package is uploaded,
// unreviewed content served from this app's own origin. A SCORM package is
// loaded through fetchShimmedLaunchDoc so its storage probes don't crash it;
// it can't reach a window.API from inside the sandbox, so it plays without
// reporting progress. An xAPI package is launched with its own short-lived
// session, so the statements it sends go to the learner's xAPI record. A
// package anyone may have shared is told only that launch, not who the
// learner is: its actor is the session, which the LRS maps back to them.
export default function SkillPackageOverlay({ resource, userId, onClose }) {
  const { t } = useLanguage()
  const [frame, setFrame] = useState(null)
  const [error, setError] = useState(null)
  const baseUrl = packageLaunchUrl(resource)
  const headingId = `skill-package-${resource.id}-title`

  useEffect(() => {
    if (!baseUrl) return undefined
    let cancelled = false
    const load = resource.kind === 'xapi'
      ? createSkillPackageLaunchSession(resource.id, userId)
        .then((session) => ({ src: buildAdlLaunchUrl(baseUrl, session, session.id, xapiActivityId(resource)) }))
      : fetchShimmedLaunchDoc(baseUrl).then((srcDoc) => ({ srcDoc }))
    load
      .then((next) => !cancelled && setFrame(next))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
    // Opened once per resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource.id, userId, baseUrl])

  return (
    <AccessibleDialog
      labelledBy={headingId}
      onClose={onClose}
      // A click outside shouldn't lose the learner's place in a course.
      closeOnBackdrop={false}
      overlayClassName="p-2! sm:p-4!"
      panelClassName="flex h-full w-full flex-col overflow-hidden rounded-md bg-paper shadow-xl focus:outline-none"
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2">
        <div className="min-w-0">
          <h2 id={headingId} className="truncate font-display text-lg text-ink">{resource.title}</h2>
          {resource.kind === 'xapi' && (
            <p className="text-xs text-secondary">{t('skillDetail.resources.packageRecordsActivity')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink hover:border-moss"
        >
          {t('skillDetail.resources.closePackage')}
        </button>
      </div>
      <div className="relative min-h-0 flex-1 bg-card">
        {!baseUrl ? (
          <p role="alert" className="p-4 text-sm text-red-700">{t('skillDetail.resources.packageNoLaunch')}</p>
        ) : error ? (
          <p role="alert" className="p-4 text-sm text-red-700">{error}</p>
        ) : !frame ? (
          <p className="p-4 text-sm text-secondary">{t('skillDetail.resources.packageLoading')}</p>
        ) : (
          <iframe
            title={resource.title}
            {...frame}
            className="absolute inset-0 h-full w-full border-0 bg-paper"
            sandbox="allow-scripts allow-forms"
          />
        )}
      </div>
    </AccessibleDialog>
  )
}
