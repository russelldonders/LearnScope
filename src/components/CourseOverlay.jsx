import { Suspense, lazy } from 'react'
import FullScreenOverlay from './FullScreenOverlay'
import { useLanguage } from '../context/LanguageContext'

// Loaded only when a course is opened, as its own page is.
const CourseLearn = lazy(() => import('../pages/CourseLearn'))

// A course's lessons, opened over the page the learner is on (the skill
// page), the same way a SCORM/xAPI package resource opens.
export default function CourseOverlay({ course, onClose }) {
  const { t } = useLanguage()
  return (
    <FullScreenOverlay title={course.name} closeLabel={t('skillDetail.close')} onClose={onClose}>
      <Suspense fallback={<p className="p-4 text-sm text-secondary">{t('common.loading')}</p>}>
        <CourseLearn courseId={course.id} inOverlay />
      </Suspense>
    </FullScreenOverlay>
  )
}
