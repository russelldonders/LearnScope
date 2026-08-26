import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { listCourseProgressByCatalogueId } from '../lib/courseContent'
import AppHeader from '../components/AppHeader'
import CourseThumbnail from '../components/CourseThumbnail'
import ProgressBar from '../components/ProgressBar'

export default function Learning() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [skillsByCourse, setSkillsByCourse] = useState(new Map())
  const [progressByCatalogueId, setProgressByCatalogueId] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('courses')
      .select('*')
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
    setLoading(false)
  }

  const inProgress = courses.filter((c) => !c.completed_date)
  const completed = courses.filter((c) => c.completed_date)

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl text-ink">Your learning</h2>
          <Link
            to="/training"
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
          >
            Find training
          </Link>
        </div>

        {loading && <p className="text-secondary">Loading…</p>}
        {error && <p className="text-red-700 text-sm">{error}</p>}

        {!loading && courses.length === 0 && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No courses logged yet. Find something to enrol in.</p>
          </div>
        )}

        {inProgress.length > 0 && (
          <div className="mb-8">
            <h3 className="font-display text-base text-ink mb-4">In progress</h3>
            <CourseGrid courses={inProgress} skillsByCourse={skillsByCourse} progressByCatalogueId={progressByCatalogueId} />
          </div>
        )}

        {completed.length > 0 && (
          <div>
            <h3 className="font-display text-base text-ink mb-4">Completed</h3>
            <CourseGrid courses={completed} skillsByCourse={skillsByCourse} progressByCatalogueId={progressByCatalogueId} />
          </div>
        )}
      </main>
    </div>
  )
}

function CourseGrid({ courses, skillsByCourse, progressByCatalogueId }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {courses.map((course) => {
        const skills = skillsByCourse.get(course.id) ?? []
        const progress = progressByCatalogueId[course.catalogue_course_id]
        const percent = progress?.total ? Math.round((progress.completed / progress.total) * 100) : null
        return (
          <Link
            key={course.id}
            to={`/courses/${course.id}`}
            state={{ backTo: '/learning', backLabel: 'Learning' }}
            className="bg-card border border-hairline rounded-lg overflow-hidden flex flex-col hover:border-moss transition-colors"
          >
            <CourseThumbnail name={course.name} provider={course.provider} className="h-24 w-full shrink-0" />
            <div className="p-4 flex flex-col flex-1">
              <h3 className="font-display text-lg text-ink">{course.name}</h3>
              <p className="font-mono text-xs text-secondary mt-0.5">
                {[course.provider, course.course_type, course.duration].filter(Boolean).join(' · ')}
              </p>
              <p className="font-mono text-xs mt-2">
                {course.completed_date ? (
                  <span className="text-moss">
                    Completed {new Date(course.completed_date).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-secondary">In progress</span>
                )}
              </p>
              {percent != null && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                      {percent}% complete
                    </span>
                    <span className="font-mono text-[10px] text-secondary">
                      {progress.completed}/{progress.total}
                    </span>
                  </div>
                  <ProgressBar percent={percent} />
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
        )
      })}
    </div>
  )
}
