import { useEffect, useState } from 'react'
import FullScreenOverlay from './FullScreenOverlay'
import { useLanguage } from '../context/LanguageContext'
import { buildAdlLaunchUrl } from '../lib/adlLaunch'
import { fetchShimmedLaunchDoc, xapiActivityId } from '../lib/courseContent'
import { createSkillPackageLaunchSession, findPackageToReopen, packageLaunchUrl } from '../lib/skillResources'

// A package opened again from a session of it (the timeline), the same way
// its skill page opens it: looked up first, since the session only says
// which package it was. title: the session's name for it, shown meanwhile.
export function ReopenPackageOverlay({ resourceId, skillId = null, title, userId, onClose }) {
  const { t } = useLanguage()
  const [found, setFound] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    findPackageToReopen(userId, resourceId, skillId)
      .then((next) => !cancelled && setFound(next))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [userId, resourceId, skillId])

  if (found?.resource) {
    return <SkillPackageOverlay resource={found.resource} userId={userId} skillId={found.skillId} onClose={onClose} />
  }
  return (
    <FullScreenOverlay title={title} closeLabel={t('skillDetail.resources.closePackage')} onClose={onClose}>
      {error || found ? (
        <p role="alert" className="p-4 text-sm text-red-700">{error ?? t('skillDetail.resources.packageUnavailable')}</p>
      ) : (
        <p className="p-4 text-sm text-secondary">{t('skillDetail.resources.packageLoading')}</p>
      )}
    </FullScreenOverlay>
  )
}

// A SCORM or xAPI package on a skill, opened over almost the whole screen.
//
// Both play in a sandboxed frame with no allow-same-origin, for the same
// reasons as ScormPlayer.jsx and XapiPlayer.jsx: the package is uploaded,
// unreviewed content served from this app's own origin. A SCORM package is
// loaded through fetchShimmedLaunchDoc so its storage probes don't crash it;
// it can't reach a window.API from inside the sandbox, so it plays without
// reporting progress. An xAPI package is launched with its own short-lived
// session, so the statements it sends go to the learner's xAPI record and
// the session shows as one activity on skillId, the skill it was opened
// from. A package anyone may have shared isn't told who the learner is: its
// actor is the learner's registration for that package (the same each time,
// so it can resume), which the LRS maps back to them.
export default function SkillPackageOverlay({ resource, userId, skillId = null, onClose }) {
  const { t } = useLanguage()
  const [frame, setFrame] = useState(null)
  const [error, setError] = useState(null)
  const baseUrl = packageLaunchUrl(resource)

  useEffect(() => {
    if (!baseUrl) return undefined
    let cancelled = false
    const load = resource.kind === 'xapi'
      ? createSkillPackageLaunchSession(resource.id, userId, skillId)
        .then((session) => ({ src: buildAdlLaunchUrl(baseUrl, session, session.registration, xapiActivityId(resource)) }))
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
    <FullScreenOverlay
      title={resource.title}
      subtitle={resource.kind === 'xapi' ? t('skillDetail.resources.packageRecordsActivity') : null}
      closeLabel={t('skillDetail.resources.closePackage')}
      onClose={onClose}
    >
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
    </FullScreenOverlay>
  )
}
