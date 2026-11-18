import { Suspense, lazy, useState } from 'react'
import FullScreenOverlay from './FullScreenOverlay'
import ProgressBar from './ProgressBar'
import { useLanguage } from '../context/LanguageContext'

// Loaded only when a course is opened, as its own page is.
const CourseLearn = lazy(() => import('../pages/CourseLearn'))

// A course's lessons, opened over the page the learner is on (the skill
// page), the same way a SCORM/xAPI package resource opens. How far through
// it they are sits in the header, beside its title.
export default function CourseOverlay({ course, onClose }) {
  const { t } = useLanguage()
  const [progress, setProgress] = useState(null)
  return (
    <FullScreenOverlay
      title={course.name}
      closeLabel={t('skillDetail.close')}
      onClose={onClose}
      headerExtra={progress && (
        <div>
          <p className="mb-1 text-right font-mono text-xs text-secondary">
            {t('courseLearn.completeCount', { done: progress.done, total: progress.total })}
          </p>
          <div
            role="progressbar"
            aria-label={t('skillDetail.learning.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <ProgressBar percent={progress.percent} />
          </div>
        </div>
      )}
    >
      <Suspense fallback={<p className="p-4 text-sm text-secondary">{t('common.loading')}</p>}>
        {/* Done on a finished course closes it, back to the page underneath. */}
        <CourseLearn courseId={course.id} inOverlay onProgressChange={setProgress} onDone={onClose} />
      </Suspense>
    </FullScreenOverlay>
  )
}
