import { Link } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'

// The learning behind a skill, styled like the Goals section, top to bottom:
// recommended (catalogue courses teaching the skill the learner has no record
// of), planned (on their learning plan), enrolled, in progress (a lesson
// started), completed and cancelled. A group with nothing in it isn't shown
// at all. Course links are associations -- listing them here changes nothing
// about the courses themselves; the actions below only change a course's own
// status (courses.status), and only on the learner's own skill.
// startedCatalogueIds: catalogue courses with a lesson started (see
// startedCatalogueCourseIds); a course outside the catalogue has no lessons
// to start, so it stays Enrolled until it's completed.
export default function SkillLearningSection({
  courseLinks,
  availableCourses = null,
  startedCatalogueIds = new Set(),
  onFindCourse,
  onOpenAvailable,
  onPlan = null,
  onEnrolPlanned = null,
  onRemovePlanned = null,
  onCancel = null,
}) {
  const { t } = useLanguage()
  const courses = courseLinks.map((link) => link.courses).filter(Boolean)
  const completed = courses
    .filter((course) => course.completed_date && course.status !== 'cancelled')
    .sort((a, b) => b.completed_date.localeCompare(a.completed_date))
  const planned = courses.filter((course) => course.status === 'planned')
  const cancelled = courses
    .filter((course) => course.status === 'cancelled')
    .sort((a, b) => (b.cancelled_at ?? '').localeCompare(a.cancelled_at ?? ''))
  const underway = courses.filter((course) => !course.completed_date && !course.status)
  const started = (course) => Boolean(course.catalogue_course_id && startedCatalogueIds.has(course.catalogue_course_id))
  const inProgress = underway.filter(started)
  const enrolled = underway.filter((course) => !started(course))
  const recommended = availableCourses ?? []
  const nothingYet = recommended.length === 0 && courses.length === 0

  return (
    <section aria-labelledby="skill-learning-heading" className="mt-4 rounded-md border border-hairline bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="skill-learning-heading" className="font-display text-xl text-ink">{t('skillDetail.learning.title')}</h2>
          <p className="text-xs text-secondary">{t('skillDetail.learning.description')}</p>
        </div>
        {onFindCourse && (
          <button
            type="button"
            onClick={onFindCourse}
            className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
          >
            {t('skillDetail.findACourse')}
          </button>
        )}
      </div>

      {nothingYet && <p className="text-sm text-secondary mt-3">{t('skillDetail.learning.nothingYet')}</p>}

      <div className="space-y-4 mt-3 empty:hidden">
        <Group title={t('skillDetail.learning.available')}>
          {recommended.map(({ course, level }) => (
            <Course
              key={course.id}
              name={course.name}
              detail={[course.provider, level ? t('skillDetail.learning.teachesLevel', { level: LEVEL_LABELS[level] }) : null]}
              onClick={() => onOpenAvailable(course)}
              actions={onPlan && [{ label: t('skillDetail.learning.addToPlan'), onClick: () => onPlan(course) }]}
            />
          ))}
        </Group>

        <Group title={t('skillDetail.learning.planned')}>
          {planned.map((course) => (
            <Course
              key={course.id}
              name={course.name}
              detail={[course.provider]}
              actions={[
                onEnrolPlanned && { label: t('skillDetail.learning.enrol'), onClick: () => onEnrolPlanned(course) },
                onRemovePlanned && { label: t('skillDetail.learning.removeFromPlan'), onClick: () => onRemovePlanned(course) },
              ]}
            />
          ))}
        </Group>

        <Group title={t('skillDetail.learning.enrolled')}>
          {enrolled.map((course) => (
            <Course
              key={course.id}
              name={course.name}
              detail={[course.provider]}
              to={`/courses/${course.id}/learn`}
              actions={onCancel && [{ label: t('skillDetail.learning.cancel'), onClick: () => onCancel(course) }]}
            />
          ))}
        </Group>

        <Group title={t('skillDetail.learning.inProgress')}>
          {inProgress.map((course) => (
            <Course
              key={course.id}
              name={course.name}
              detail={[course.provider]}
              to={`/courses/${course.id}/learn`}
              actions={onCancel && [{ label: t('skillDetail.learning.cancel'), onClick: () => onCancel(course) }]}
            />
          ))}
        </Group>

        <Group title={t('skillDetail.learning.completed')}>
          {completed.map((course) => (
            <Course
              key={course.id}
              name={course.name}
              detail={[course.provider, t('skillDetail.learning.completedOn', { date: formatFullDate(course.completed_date) })]}
              to={`/courses/${course.id}`}
            />
          ))}
        </Group>

        <Group title={t('skillDetail.learning.cancelled')}>
          {cancelled.map((course) => (
            <Course
              key={course.id}
              name={course.name}
              detail={[course.provider, course.cancelled_at ? t('skillDetail.learning.cancelledOn', { date: formatFullDate(course.cancelled_at) }) : null]}
            />
          ))}
        </Group>
      </div>
    </section>
  )
}

// Not shown at all when there's nothing in it.
function Group({ title, children }) {
  const items = [children].flat().filter(Boolean)
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-1">{title}</h3>
      <ul className="divide-y divide-hairline">{items}</ul>
    </div>
  )
}

function Course({ name, detail, to = null, onClick = null, actions = null }) {
  const shownActions = (actions ?? []).filter(Boolean)
  const text = (
    <>
      <span className={`block text-sm text-ink ${to || onClick ? 'group-hover:text-moss group-hover:underline underline-offset-2' : ''}`}>{name}</span>
      {detail.filter(Boolean).length > 0 && (
        <span className="block text-xs text-secondary">{detail.filter(Boolean).join(' · ')}</span>
      )}
    </>
  )
  return (
    <li className="py-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {to ? (
          <Link to={to} className="group block">{text}</Link>
        ) : onClick ? (
          <button type="button" onClick={onClick} className="group block w-full text-left">{text}</button>
        ) : (
          <div>{text}</div>
        )}
      </div>
      {shownActions.length > 0 && (
        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 shrink-0">
          {shownActions.map((action) => (
            <button key={action.label} type="button" onClick={action.onClick} className="text-xs font-medium text-moss hover:underline">
              {action.label}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}
