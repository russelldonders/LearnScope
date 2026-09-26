import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import CourseThumbnail from '../../components/CourseThumbnail'
import StatusBadge from '../../components/StatusBadge'
import { useAuth } from '../../context/AuthContext'
import { listMyCourseAssignmentsForEmployer, respondToCourseAssignment } from '../../lib/courseCatalogue'
import { supabase } from '../../lib/supabaseClient'

function courseMeta(course) {
  return [course.course_type, course.duration, course.provider].filter(Boolean).join(' · ')
}

function CourseAction({ assignment, course, status, busy, onOpen }) {
  const labels = { 'not-started': 'Start learning', 'in-progress': 'Continue', completed: 'Review' }
  return (
    <button
      type="button"
      onClick={() => onOpen(assignment, course)}
      disabled={busy}
      className="shrink-0 rounded-md bg-[var(--org-primary,var(--color-moss))] px-4 py-2 text-sm font-medium text-[var(--org-primary-contrast,var(--color-paper))] hover:bg-[var(--org-hover,var(--org-primary,var(--color-moss)))] hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? 'Opening…' : labels[status.key]}
    </button>
  )
}

function LearningRow({ assignment, course, status, busy, onOpen }) {
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center">
      <CourseThumbnail
        name={course.name}
        provider={course.provider}
        imageUrl={course.image_url}
        gradientColors={['var(--org-primary,var(--color-moss))', 'var(--org-hover,var(--color-slate))']}
        className="h-14 w-14 sm:h-16 sm:w-16 rounded-md overflow-hidden"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink truncate">{course.name}</p>
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
        {courseMeta(course) && <p className="text-xs text-secondary mt-1">{courseMeta(course)}</p>}
      </div>
      <div className="col-start-2 sm:col-start-3">
        <CourseAction assignment={assignment} course={course} status={status} busy={busy} onOpen={onOpen} />
      </div>
    </li>
  )
}

export default function EmployerAssignedTrainingPanel({
  employerId,
  employerName = 'your employer',
  employerLogoUrl,
  variant = 'full',
  viewAllHref,
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [assignments, setAssignments] = useState([])
  const [learnerCourses, setLearnerCourses] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openingId, setOpeningId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listMyCourseAssignmentsForEmployer(user.id, employerId)
      .then(async (rows) => {
        if (cancelled) return
        setAssignments(rows)
        const catalogueIds = rows.map((row) => row.catalogue_course_id)
        if (catalogueIds.length === 0) return
        const { data, error: coursesError } = await supabase
          .from('courses')
          .select('id, catalogue_course_id, completed_date')
          .eq('user_id', user.id)
          .in('catalogue_course_id', catalogueIds)
        if (coursesError) throw coursesError
        if (cancelled) return
        setLearnerCourses(new Map((data ?? []).map((course) => [course.catalogue_course_id, course])))
      })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user.id, employerId])

  function statusFor(assignment) {
    const learnerCourse = learnerCourses.get(assignment.catalogue_course_id)
    if (learnerCourse?.completed_date) return { key: 'completed', label: 'Completed', tone: 'success' }
    if (assignment.status === 'enrolled' || learnerCourse) return { key: 'in-progress', label: 'In progress', tone: 'warning' }
    return { key: 'not-started', label: 'Not started', tone: 'neutral' }
  }

  const grouped = (() => {
    const result = { 'in-progress': [], 'not-started': [], completed: [] }
    for (const assignment of assignments) result[statusFor(assignment).key].push(assignment)
    return result
  })()

  async function openCourse(assignment, catalogueCourse) {
    const existingCourse = learnerCourses.get(assignment.catalogue_course_id)
    if (existingCourse) {
      navigate(`/courses/${existingCourse.id}/learn`, {
        state: { backTo: `${location.pathname}${location.search}`, backLabel: employerName },
      })
      return
    }

    setOpeningId(assignment.id)
    setError(null)
    try {
      const enrolledCourse = await respondToCourseAssignment(user.id, assignment.id, {
        enrol: true,
        courseForEnrolment: catalogueCourse,
      })
      setAssignments((current) => current.map((item) => item.id === assignment.id ? { ...item, status: 'enrolled' } : item))
      setLearnerCourses((current) => new Map(current).set(assignment.catalogue_course_id, enrolledCourse))
      navigate(`/courses/${enrolledCourse.id}/learn`, {
        state: { backTo: `${location.pathname}${location.search}`, backLabel: employerName },
      })
    } catch (err) {
      setError(err.message)
      setOpeningId(null)
    }
  }

  if (loading) return <p className="text-sm text-secondary" aria-live="polite">Loading your learning…</p>

  if (variant === 'home') {
    const focus = grouped['in-progress'][0] ?? grouped['not-started'][0] ?? grouped.completed[0]
    const upNext = [...grouped['in-progress'], ...grouped['not-started']].filter((item) => item.id !== focus?.id).slice(0, 3)
    const completed = grouped.completed.filter((item) => item.id !== focus?.id).slice(0, 3)

    return (
      <section aria-labelledby="continue-learning-heading">
        {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <p className="text-xs font-medium text-secondary uppercase tracking-[0.12em]">Your learning</p>
            <h2 id="continue-learning-heading" className="font-display text-2xl text-ink mt-1">
              {focus && statusFor(focus).key === 'not-started' && 'Start learning'}
              {focus && statusFor(focus).key === 'in-progress' && 'Continue learning'}
              {focus && statusFor(focus).key === 'completed' && 'Review learning'}
              {!focus && 'Your learning'}
            </h2>
          </div>
          {viewAllHref && <Link to={viewAllHref} className="text-sm font-medium text-[var(--org-text,var(--color-ink))] underline underline-offset-4 decoration-hairline hover:decoration-current">View all</Link>}
        </div>

        {focus ? (
          <div className="overflow-hidden rounded-lg border border-hairline bg-card sm:grid sm:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]">
            <CourseThumbnail
              name={focus.course_catalogue.name}
              provider={focus.course_catalogue.provider}
              logoUrl={employerLogoUrl}
              imageUrl={focus.course_catalogue.image_url}
              gradientColors={['var(--org-primary,var(--color-moss))', 'var(--org-hover,var(--color-slate))']}
              className="h-40 w-full sm:h-full sm:min-h-56 overflow-hidden"
            />
            <div className="p-5 sm:p-7 flex flex-col justify-center items-start">
              <StatusBadge label={statusFor(focus).label} tone={statusFor(focus).tone} />
              <h3 className="font-display text-2xl text-ink mt-4">{focus.course_catalogue.name}</h3>
              {courseMeta(focus.course_catalogue) && <p className="text-sm text-secondary mt-2">{courseMeta(focus.course_catalogue)}</p>}
              <p className="text-xs text-secondary mt-2">Assigned by {employerName}</p>
              <div className="mt-6">
                <CourseAction assignment={focus} course={focus.course_catalogue} status={statusFor(focus)} busy={openingId === focus.id} onOpen={openCourse} />
              </div>
            </div>
          </div>
        ) : (
          <div className="border-y border-hairline py-6">
            <p className="font-medium text-ink">You are all caught up.</p>
            <p className="text-sm text-secondary mt-1">There is no learning assigned by {employerName} yet.</p>
          </div>
        )}

        {upNext.length > 0 && (
          <div className="mt-9">
            <h3 className="font-display text-xl text-ink">Up next</h3>
            <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
              {upNext.map((assignment) => (
                <LearningRow key={assignment.id} assignment={assignment} course={assignment.course_catalogue} status={statusFor(assignment)} busy={openingId === assignment.id} onOpen={openCourse} />
              ))}
            </ul>
          </div>
        )}

        {completed.length > 0 && (
          <div className="mt-9">
            <h3 className="font-display text-xl text-ink">Recently completed</h3>
            <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
              {completed.map((assignment) => (
                <LearningRow key={assignment.id} assignment={assignment} course={assignment.course_catalogue} status={statusFor(assignment)} busy={false} onOpen={openCourse} />
              ))}
            </ul>
          </div>
        )}
      </section>
    )
  }

  const sections = [
    { key: 'in-progress', title: 'In progress' },
    { key: 'not-started', title: 'Not started' },
    { key: 'completed', title: 'Completed' },
  ]

  return (
    <section aria-labelledby="employer-assigned-training-heading">
      <div className="mb-6">
        <p className="text-xs font-medium text-secondary uppercase tracking-[0.12em]">Assigned by {employerName}</p>
        <h2 id="employer-assigned-training-heading" className="font-display text-2xl text-ink mt-1">Learning plan</h2>
        <p className="text-sm text-secondary mt-2">Start new courses, continue active learning, or revisit completed training.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}
      {assignments.length === 0 ? (
        <div className="border-y border-hairline py-6">
          <p className="font-medium text-ink">No assigned learning yet.</p>
          <p className="text-sm text-secondary mt-1">New learning from {employerName} will appear here.</p>
        </div>
      ) : (
        <div className="space-y-9">
          {sections.filter((section) => grouped[section.key].length > 0).map((section) => (
            <div key={section.key}>
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-display text-xl text-ink">{section.title}</h3>
                <span className="font-mono text-xs text-secondary">{grouped[section.key].length}</span>
              </div>
              <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
                {grouped[section.key].map((assignment) => (
                  <LearningRow key={assignment.id} assignment={assignment} course={assignment.course_catalogue} status={statusFor(assignment)} busy={openingId === assignment.id} onOpen={openCourse} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
