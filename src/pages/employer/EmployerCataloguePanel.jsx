import { useEffect, useMemo, useState } from 'react'
import CourseThumbnail from '../../components/CourseThumbnail'
import CohortPickerModal from '../../components/CohortPickerModal'
import { useAuth } from '../../context/AuthContext'
import {
  enrolInCatalogueCourse,
  enrolInCourseCohort,
  listCourseCohorts,
  listEnrolledCatalogueIds,
} from '../../lib/courseCatalogue'
import { listMyEmployerCatalogueCourses } from '../../lib/employerCatalogues'

export default function EmployerCataloguePanel({ employerId, employerName, employerLogoUrl }) {
  const { user } = useAuth()
  const userId = user?.id
  const [courses, setCourses] = useState([])
  const [enrolledIds, setEnrolledIds] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [enrollingId, setEnrollingId] = useState(null)
  const [cohortPicker, setCohortPicker] = useState(null)
  const [cohortEnrolling, setCohortEnrolling] = useState(false)
  const [cohortError, setCohortError] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      listMyEmployerCatalogueCourses(employerId),
      userId ? listEnrolledCatalogueIds(userId) : Promise.resolve(new Map()),
    ])
      .then(([availableCourses, enrolled]) => {
        if (cancelled) return
        setCourses(availableCourses)
        setEnrolledIds(enrolled)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [employerId, userId])

  const filteredCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return courses
    return courses.filter((course) => [
      course.name,
      course.provider,
      course.synopsis,
      ...(course.catalogues ?? []).map((catalogue) => catalogue.name),
    ].some((value) => value?.toLowerCase().includes(normalizedQuery)))
  }, [courses, query])

  async function enrol(course) {
    setError(null)
    setEnrollingId(course.id)
    try {
      const cohorts = await listCourseCohorts(course.id)
      if (cohorts.length > 0) {
        setCohortError(null)
        setCohortPicker({ course, cohorts })
        return
      }
      const enrolled = await enrolInCatalogueCourse(userId, course)
      setEnrolledIds((current) => new Map(current).set(course.id, { id: enrolled.id, completedDate: enrolled.completed_date }))
    } catch (err) {
      setError(err.message)
    } finally {
      setEnrollingId(null)
    }
  }

  async function enrolInCohort(cohortId) {
    const { course } = cohortPicker
    setCohortError(null)
    setCohortEnrolling(true)
    try {
      const enrolled = await enrolInCourseCohort(cohortId)
      setEnrolledIds((current) => new Map(current).set(course.id, { id: enrolled.id, completedDate: enrolled.completed_date }))
      setCohortPicker(null)
    } catch (err) {
      setCohortError(err.message)
    } finally {
      setCohortEnrolling(false)
    }
  }

  if (loading) return <p className="text-sm text-secondary">Loading catalogue…</p>

  return (
    <section aria-labelledby="employer-catalogue-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="employer-catalogue-heading" className="font-display text-2xl text-ink">Available through {employerName}</h2>
          <p className="text-sm text-secondary mt-1">Browse learning your employer has made available to you.</p>
        </div>
        {courses.length > 0 && (
          <label className="block sm:w-72">
            <span className="sr-only">Search catalogue</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search catalogue"
              className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink placeholder:text-secondary"
            />
          </label>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mt-4">{error}</p>}
      {courses.length === 0 && !error && (
        <div className="mt-6 rounded-lg border border-dashed border-hairline p-8 text-center">
          <p className="text-secondary">There are no catalogues available to you yet.</p>
        </div>
      )}
      {courses.length > 0 && filteredCourses.length === 0 && (
        <p className="text-sm text-secondary mt-6">No learning matches “{query}”.</p>
      )}

      <div className="grid grid-cols-1 gap-4 mt-6 sm:grid-cols-2">
        {filteredCourses.map((course) => {
          const enrolment = enrolledIds.get(course.id)
          return (
            <article key={course.id} className="overflow-hidden rounded-lg border border-hairline bg-card flex flex-col">
              <CourseThumbnail
                name={course.name}
                provider={course.provider || employerName}
                logoUrl={employerLogoUrl}
                imageUrl={course.imageUrl}
                className="h-28 w-full shrink-0"
              />
              <div className="p-4 flex flex-1 flex-col">
                <p className="font-mono text-[11px] uppercase tracking-wide text-moss">
                  {(course.catalogues ?? []).map((catalogue) => catalogue.name).join(' · ')}
                </p>
                <h3 className="font-display text-lg text-ink mt-1">{course.name}</h3>
                <p className="font-mono text-xs text-secondary mt-1">
                  {[course.provider, course.courseType, course.duration].filter(Boolean).join(' · ')}
                </p>
                {course.synopsis && <p className="text-sm text-secondary mt-3 line-clamp-3 flex-1">{course.synopsis}</p>}
                <button
                  type="button"
                  onClick={() => enrol(course)}
                  disabled={Boolean(enrolment) || enrollingId === course.id}
                  className="mt-4 self-start rounded-md bg-[var(--org-primary,var(--color-moss))] px-3 py-2 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {enrolment?.completedDate ? 'Completed ✓' : enrolment ? 'Enrolled ✓' : enrollingId === course.id ? 'Enrolling…' : 'Enrol'}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {cohortPicker && (
        <CohortPickerModal
          courseName={cohortPicker.course.name}
          cohorts={cohortPicker.cohorts}
          enrolling={cohortEnrolling}
          error={cohortError}
          onEnrol={enrolInCohort}
          onClose={() => setCohortPicker(null)}
        />
      )}
    </section>
  )
}
