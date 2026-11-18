import { Link } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import ProgressBar from './ProgressBar'

// The learning behind a skill, styled like the Goals section, top to bottom:
// recommended (catalogue courses teaching the skill the learner has no record
// of), planned (on their learning plan), enrolled, in progress (a lesson
// started), completed and cancelled. A group with nothing in it isn't shown
// at all. Course links are associations -- listing them here changes nothing
// about the courses themselves; the actions below only change a course's own
// status (courses.status), and only on the learner's own skill.
// progressByCatalogueId: catalogue course id -> { completed, total } lessons
// (see listCourseProgressByCatalogueId). A course with a lesson started is In
// progress, with a progress bar; a course outside the catalogue has no
// lessons to start, so it stays Enrolled until it's completed.
// A recommended course can be enrolled in straight away (onEnrol) or added
// to the plan first (onPlan); a planned one enrolled in from the plan
// (onEnrolPlanned). enrollingId: the course being enrolled in just now.
// onOpenCourse: opens an enrolled course's lessons over the page (on the
// learner's own skill); without it, the course's own page is linked.
export default function SkillLearningSection({
  courseLinks,
  availableCourses = null,
  progressByCatalogueId = {},
  onFindCourse,
  onOpenAvailable,
  onEnrol = null,
  enrollingId = null,
  onOpenCourse = null,
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
  const progressOf = (course) => (course.catalogue_course_id ? progressByCatalogueId[course.catalogue_course_id] : null)
  const started = (course) => (progressOf(course)?.completed ?? 0) > 0
  const percentOf = (course) => {
    const progress = progressOf(course)
    return progress?.total ? Math.round((progress.completed / progress.total) * 100) : null
  }
  // An enrolled course opens over the page where it can, else on its own page.
  const openProps = (course) => (onOpenCourse
    ? { onClick: () => onOpenCourse(course), opensDialog: true }
    : { to: `/courses/${course.id}/learn` })
  const enrolAction = (course, handler) => handler && {
    label: enrollingId === course.id ? t('skillDetail.learning.enrolling') : t('skillDetail.learning.enrol'),
    onClick: () => handler(course),
    primary: true,
    disabled: Boolean(enrollingId),
  }
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
              cta={t('skillDetail.learning.viewCourse')}
              actions={[
                enrolAction(course, onEnrol),
                onPlan && { label: t('skillDetail.learning.addToPlan'), onClick: () => onPlan(course), disabled: Boolean(enrollingId) },
              ]}
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
                enrolAction(course, onEnrolPlanned),
                onRemovePlanned && { label: t('skillDetail.learning.removeFromPlan'), onClick: () => onRemovePlanned(course), disabled: Boolean(enrollingId) },
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
              {...openProps(course)}
              cta={t('skillDetail.learning.startCourse')}
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
              {...openProps(course)}
              cta={t('skillDetail.learning.continueCourse')}
              percent={percentOf(course)}
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
              cta={t('skillDetail.learning.viewCourse')}
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

// A course row. One that opens somewhere reads as a link: its name in the
// link colour, a "Continue →"-style prompt, and the whole row highlighting on
// hover. percent: how far through it the learner is, as a progress bar.
function Course({ name, detail, to = null, onClick = null, opensDialog = false, cta = null, percent = null, actions = null }) {
  const { t } = useLanguage()
  const shownActions = (actions ?? []).filter(Boolean)
  const opens = Boolean(to || onClick)
  const shownDetail = detail.filter(Boolean)
  const text = (
    <>
      <span className={`block text-sm ${opens ? 'font-medium text-moss group-hover:underline underline-offset-2' : 'text-ink'}`}>{name}</span>
      {shownDetail.length > 0 && <span className="block text-xs text-secondary">{shownDetail.join(' · ')}</span>}
      {percent != null && (
        <span className="mt-1.5 block max-w-xs">
          <span className="block text-xs text-secondary">{t('skillDetail.learning.percentComplete', { percent })}</span>
          <span
            role="progressbar"
            aria-label={t('skillDetail.learning.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-1 block"
          >
            <ProgressBar percent={percent} />
          </span>
        </span>
      )}
      {opens && cta && (
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-moss">
          {cta}
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      )}
    </>
  )
  const linkClass = 'group -mx-2 block rounded-md px-2 py-1 text-left hover:bg-card focus-visible:bg-card'
  return (
    <li className="py-1.5 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {to ? (
          <Link to={to} className={linkClass}>{text}</Link>
        ) : onClick ? (
          <button type="button" onClick={onClick} aria-haspopup={opensDialog ? 'dialog' : undefined} className={`${linkClass} w-full`}>{text}</button>
        ) : (
          <div className="py-1">{text}</div>
        )}
      </div>
      {shownActions.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 shrink-0 pt-1">
          {shownActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={action.primary
                ? 'rounded-md bg-moss text-paper text-xs font-medium px-3 py-1 hover:opacity-90 disabled:opacity-60'
                : 'text-xs font-medium text-moss hover:underline disabled:opacity-60'}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}
