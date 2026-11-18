import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { listCourseProgressByCatalogueId } from '../lib/courseContent'
import { listMyAssignedCourseEmployers } from '../lib/courseCatalogue'
import AppHeader from '../components/AppHeader'
import CourseThumbnail from '../components/CourseThumbnail'
import ProgressBar from '../components/ProgressBar'
import { formatFullDate } from '../lib/dates'

export default function Learning() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [courses, setCourses] = useState([])
  const [skillsByCourse, setSkillsByCourse] = useState(new Map())
  const [progressByCatalogueId, setProgressByCatalogueId] = useState({})
  const [assignedByCatalogueId, setAssignedByCatalogueId] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Which of the learner's courses to show, by where they are with them.
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('courses')
      .select('*, course_catalogue(image_url, organisations(logo_url))')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setCourses(data ?? [])

    const ids = (data ?? []).map((c) => c.id)
    if (ids.length > 0) {
      const { data: links } = await supabase
        .from('skill_course_links')
        .select('course_id, skills(id, name)')
        .in('course_id', ids)
      const map = new Map()
      for (const link of links ?? []) {
        if (!link.skills) continue
        if (!map.has(link.course_id)) map.set(link.course_id, [])
        map.get(link.course_id).push(link.skills)
      }
      setSkillsByCourse(map)
    } else {
      setSkillsByCourse(new Map())
    }

    const catalogueIds = (data ?? []).map((c) => c.catalogue_course_id)
    setProgressByCatalogueId(await listCourseProgressByCatalogueId(catalogueIds, user.id))
    setAssignedByCatalogueId(await listMyAssignedCourseEmployers(user.id))
    setLoading(false)
  }

  // Planned (on the learning plan), in progress, completed and cancelled
  // (courses.status), each shown only when it has something in it. The
  // filter shows one of them, or all of them under their own headings.
  const groups = [
    ['planned', courses.filter((c) => c.status === 'planned')],
    ['inProgress', courses.filter((c) => !c.status && !c.completed_date)],
    ['completed', courses.filter((c) => !c.status && c.completed_date)],
    ['cancelled', courses.filter((c) => c.status === 'cancelled')],
  ].filter(([, list]) => list.length > 0)
  // A filter left on a group that has since emptied falls back to all.
  const activeFilter = groups.some(([key]) => key === filter) ? filter : 'all'
  const shownGroups = activeFilter === 'all' ? groups : groups.filter(([key]) => key === activeFilter)
  const listProps = { skillsByCourse, progressByCatalogueId, assignedByCatalogueId }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between mb-8">
          <div className="max-w-2xl">
            <h1 className="font-display text-3xl sm:text-4xl text-ink text-balance">{t('learning.heading')}</h1>
            <p className="text-secondary mt-2 text-pretty">
              {t('learning.subheading')}
            </p>
          </div>
          <Link
            to="/training"
            className="rounded-md bg-moss text-paper py-2.5 px-4 font-medium hover:opacity-90 shrink-0 self-start"
          >
            {t('learning.findTraining')}
          </Link>
        </div>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}

        {!loading && courses.length === 0 && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">{t('learning.emptyState')}</p>
          </div>
        )}

        {groups.length > 1 && (
          <div role="group" aria-label={t('learning.filterLabel')} className="flex flex-wrap gap-1.5 mb-6">
            {[['all', courses.length], ...groups.map(([key, list]) => [key, list.length])].map(([key, count]) => (
              <button
                key={key}
                type="button"
                aria-pressed={activeFilter === key}
                onClick={() => setFilter(key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${activeFilter === key
                  ? 'border-moss bg-moss/10 text-ink'
                  : 'border-hairline text-secondary hover:text-ink'}`}
              >
                {key === 'all' ? t('learning.filterAll') : t(`learning.${key}`)}
                <span className="ml-1.5 tabular-nums text-secondary">{count}</span>
              </button>
            ))}
          </div>
        )}

        {shownGroups.map(([key, list]) => (
          <section key={key} aria-labelledby={`learning-${key}`} className="mb-8">
            <h2 id={`learning-${key}`} className="font-display text-base text-ink mb-2">{t(`learning.${key}`)}</h2>
            <CourseList courses={list} {...listProps} />
          </section>
        ))}
      </main>
    </div>
  )
}

// The courses as a list, one row each: a small thumbnail, the course and
// where it's from, where the learner is with it -- progress as a bar while
// it's under way -- and the skills it's linked to.
function CourseList({ courses, skillsByCourse, progressByCatalogueId, assignedByCatalogueId }) {
  const { t } = useLanguage()
  return (
    <ul className="divide-y divide-hairline border-y border-hairline">
      {courses.map((course) => {
        const skills = skillsByCourse.get(course.id) ?? []
        const progress = progressByCatalogueId[course.catalogue_course_id]
        const percent = progress?.total ? Math.round((progress.completed / progress.total) * 100) : null
        const assignedByEmployer = assignedByCatalogueId?.get(course.catalogue_course_id)
        return (
          <li key={course.id}>
            <Link
              // A planned course is enrolled on from the catalogue; a cancelled
              // one opens its record.
              to={course.status === 'planned' ? '/training' : course.status === 'cancelled' ? `/courses/${course.id}` : `/courses/${course.id}/learn`}
              state={{ backTo: '/learning', backLabel: 'Learning' }}
              className="group flex items-start gap-4 py-3 px-2 -mx-2 rounded-md hover:bg-card focus-visible:bg-card"
            >
              <CourseThumbnail
                name={course.name}
                provider={course.provider}
                imageUrl={course.course_catalogue?.image_url}
                logoUrl={course.course_catalogue?.organisations?.logo_url}
                className="h-14 w-20 shrink-0 rounded-md overflow-hidden"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <h3 className="text-sm font-medium text-ink group-hover:text-moss group-hover:underline underline-offset-2 break-words">
                    {course.name}
                  </h3>
                  {/* The heading above already says planned or in progress;
                      only when it was completed or cancelled adds anything. */}
                  {course.status === 'cancelled' ? (
                    <span className="font-mono text-xs shrink-0 text-secondary">{t('learning.cancelledOn', { date: formatFullDate(course.cancelled_at) })}</span>
                  ) : !course.status && course.completed_date ? (
                    <span className="font-mono text-xs shrink-0 text-moss">{t('learning.completed')} {formatFullDate(course.completed_date)}</span>
                  ) : null}
                </div>
                <p className="text-xs text-secondary mt-0.5 flex flex-wrap items-center gap-x-2">
                  {assignedByEmployer ? (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-paper bg-moss rounded-full px-2 py-0.5">
                      {t('learning.assignedByPrefix')} {assignedByEmployer}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-wide">{t('learning.personal')}</span>
                  )}
                  {[course.provider, course.course_type, course.duration].filter(Boolean).length > 0 && (
                    <span>{[course.provider, course.course_type, course.duration].filter(Boolean).join(' · ')}</span>
                  )}
                </p>
                {percent != null && !course.completed_date && !course.status && (
                  <div className="mt-2 flex items-center gap-3 max-w-sm">
                    <ProgressBar percent={percent} className="flex-1" />
                    <span className="font-mono text-[10px] text-secondary tabular-nums shrink-0">
                      {percent}% {t('learning.percentCompleteSuffix')} · {progress.completed}/{progress.total}
                    </span>
                  </div>
                )}
                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {skills.map((s) => (
                      <span
                        key={s.id}
                        className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5"
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
