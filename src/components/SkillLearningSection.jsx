import { Link } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'

// The learning behind a skill, styled like the Goals section: courses done,
// courses under way, and courses in LearnScope's catalogue that teach this
// skill and the learner hasn't started. Course links are associations --
// listing them here changes nothing about the courses themselves.
export default function SkillLearningSection({ courseLinks, availableCourses = null, onFindCourse, onOpenAvailable }) {
  const { t } = useLanguage()
  const courses = courseLinks.map((link) => link.courses).filter(Boolean)
  const completed = courses
    .filter((course) => course.completed_date)
    .sort((a, b) => b.completed_date.localeCompare(a.completed_date))
  const enrolled = courses.filter((course) => !course.completed_date)

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

      <div className="space-y-4 mt-3">
        <Group title={t('skillDetail.learning.completed')} empty={t('skillDetail.learning.noneCompleted')}>
          {completed.map((course) => (
            <Course
              key={course.id}
              name={course.name}
              detail={[course.provider, t('skillDetail.learning.completedOn', { date: formatFullDate(course.completed_date) })]}
              to={`/courses/${course.id}`}
            />
          ))}
        </Group>

        <Group title={t('skillDetail.learning.enrolled')} empty={t('skillDetail.learning.noneEnrolled')}>
          {enrolled.map((course) => (
            <Course key={course.id} name={course.name} detail={[course.provider]} to={`/courses/${course.id}/learn`} />
          ))}
        </Group>

        {availableCourses && (
          <Group title={t('skillDetail.learning.available')} empty={t('skillDetail.learning.noneAvailable')}>
            {availableCourses.map(({ course, level }) => (
              <Course
                key={course.id}
                name={course.name}
                detail={[course.provider, level ? t('skillDetail.learning.teachesLevel', { level: LEVEL_LABELS[level] }) : null]}
                onClick={() => onOpenAvailable(course)}
              />
            ))}
          </Group>
        )}
      </div>
    </section>
  )
}

function Group({ title, empty, children }) {
  const items = [children].flat().filter(Boolean)
  return (
    <div>
      <h3 className="text-sm font-medium text-ink mb-1">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-secondary">{empty}</p>
      ) : (
        <ul className="divide-y divide-hairline">{items}</ul>
      )}
    </div>
  )
}

function Course({ name, detail, to = null, onClick = null }) {
  const text = (
    <>
      <span className="block text-sm text-ink group-hover:text-moss group-hover:underline underline-offset-2">{name}</span>
      {detail.filter(Boolean).length > 0 && (
        <span className="block text-xs text-secondary">{detail.filter(Boolean).join(' · ')}</span>
      )}
    </>
  )
  return (
    <li className="py-2">
      {to ? (
        <Link to={to} className="group block">{text}</Link>
      ) : (
        <button type="button" onClick={onClick} className="group block w-full text-left">{text}</button>
      )}
    </li>
  )
}
