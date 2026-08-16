import { useEffect, useState } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { getCatalogueCourse } from '../lib/courseCatalogue'
import { LEVEL_LABELS } from '../lib/levels'
import AppHeader from '../components/AppHeader'

export default function CourseDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const location = useLocation()
  const backTo = location.state?.backTo ?? '/experience'
  const backLabel = location.state?.backLabel ? `← Back to ${location.state.backLabel}` : '← Back'

  const [course, setCourse] = useState(null)
  const [catalogueCourse, setCatalogueCourse] = useState(null)
  const [skillLinks, setSkillLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [id])

  async function load() {
    setLoading(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setCourse(data)
    const [{ data: links }, catalogue] = await Promise.all([
      supabase.from('skill_course_links').select('id, relationship, skills(id, name)').eq('course_id', id),
      data.catalogue_course_id ? getCatalogueCourse(data.catalogue_course_id) : Promise.resolve(null),
    ])
    setSkillLinks((links ?? []).filter((l) => l.skills))
    setCatalogueCourse(catalogue)
    setLoading(false)
  }

  async function handleFinish() {
    setError(null)
    setFinishing(true)
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('courses').update({ completed_date: today }).eq('id', id)
    if (error) {
      setError(error.message)
      setFinishing(false)
      return
    }
    await load()
    setFinishing(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link to={backTo} className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          {backLabel}
        </Link>

        {loading && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Course not found.</p>}

        {course && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <h2 className="font-display text-2xl text-ink">{course.name}</h2>
            <p className="font-mono text-xs text-secondary mt-1">
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

            {catalogueCourse?.synopsis && <p className="text-sm text-ink mt-4">{catalogueCourse.synopsis}</p>}

            {course.notes && (
              <div className="mt-4">
                <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-1">Notes</h4>
                <p className="text-sm text-ink whitespace-pre-line">{course.notes}</p>
              </div>
            )}

            {catalogueCourse && (catalogueCourse.skillEntries.length > 0 || catalogueCourse.tags.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-4">
                {catalogueCourse.skillEntries.map((e) => (
                  <span
                    key={e.skillId}
                    className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5"
                  >
                    {e.skillName} · {LEVEL_LABELS[e.level]}
                  </span>
                ))}
                {catalogueCourse.tags.map((t) => (
                  <span
                    key={t.id}
                    className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            )}

            {skillLinks.length > 0 && (
              <div className="mt-6">
                <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">
                  Linked to your skills
                </h4>
                <ul className="space-y-1">
                  {skillLinks.map((l) => (
                    <li key={l.id} className="text-sm">
                      <Link to={`/skills/${l.skills.id}`} className="text-moss hover:underline">
                        {l.skills.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-sm text-red-700 mt-4">{error}</p>}

            {!course.completed_date && (
              <button
                type="button"
                onClick={handleFinish}
                disabled={finishing}
                className="mt-6 rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {finishing ? 'Marking finished…' : 'Finish the course'}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
