import { useEffect, useState } from 'react'
import FullScreenOverlay from './FullScreenOverlay'
import XapiPlayer from './XapiPlayer'
import Cmi5Player from './Cmi5Player'
import { useLanguage } from '../context/LanguageContext'
import { findCourseLessonToReopen } from '../lib/courseContent'

// A SCORM, xAPI or cmi5 package in a course, opened over almost the whole
// screen the way a package on a skill is (SkillPackageOverlay): the lesson
// shows what it is with an Open button, and the package only starts -- and,
// for xAPI/cmi5, only starts a launch session -- once asked for. children:
// the player, given fill so it takes up the whole window. recordsActivity:
// says in the header that what it reports goes to the learner's record.
export default function CoursePackageLauncher({ item, recordsActivity = false, children }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="flex items-center gap-3 rounded-md border border-hairline bg-paper px-3 py-2.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-secondary shrink-0">
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M10 8.5v6l5-3z" />
        </svg>
        <span className="text-sm text-ink flex-1 min-w-0 truncate">{item.title}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="shrink-0 rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90"
        >
          {t('skillDetail.resources.openPackage')}
        </button>
      </div>
      {open && (
        <FullScreenOverlay
          title={item.title}
          subtitle={recordsActivity ? t('skillDetail.resources.packageRecordsActivity') : null}
          closeLabel={t('skillDetail.resources.closePackage')}
          onClose={() => setOpen(false)}
        >
          {children}
        </FullScreenOverlay>
      )}
    </>
  )
}

// A package lesson opened again from a session of it on the timeline, in
// the same window as from its course: looked up first, since the session
// only says which lesson in which of the learner's courses it was. title:
// the session's name for it, shown meanwhile.
export function ReopenLessonOverlay({ courseId, itemId, title, userId, onClose }) {
  const { t } = useLanguage()
  const [found, setFound] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    findCourseLessonToReopen(userId, courseId, itemId)
      .then((next) => !cancelled && setFound(next))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [userId, courseId, itemId])

  const Player = found?.item.type === 'cmi5' ? Cmi5Player : XapiPlayer
  return (
    <FullScreenOverlay
      title={found?.item.title ?? title}
      subtitle={t('skillDetail.resources.packageRecordsActivity')}
      closeLabel={t('skillDetail.resources.closePackage')}
      onClose={onClose}
    >
      {found ? (
        <Player contentItem={found.item} userId={userId} courseId={found.courseId} fill />
      ) : error || found === null ? (
        <p role="alert" className="p-4 text-sm text-red-700">{error ?? t('skillDetail.resources.packageUnavailable')}</p>
      ) : (
        <p className="p-4 text-sm text-secondary">{t('skillDetail.resources.packageLoading')}</p>
      )}
    </FullScreenOverlay>
  )
}
