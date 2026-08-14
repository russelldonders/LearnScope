import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import AppHeader from '../components/AppHeader'

export default function CourseCatalogue() {
  const { user } = useAuth()
  const [catalogue, setCatalogue] = useState([])
  const [enrolledIds, setEnrolledIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [enrollingId, setEnrollingId] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [{ data: catalogueData, error: catalogueError }, { data: enrolled }] = await Promise.all([
      supabase.from('course_catalogue').select('*').order('name'),
      supabase
        .from('courses')
        .select('catalogue_course_id')
        .eq('user_id', user.id)
        .not('catalogue_course_id', 'is', null),
    ])
    if (catalogueError) setError(catalogueError.message)
    setCatalogue(catalogueData ?? [])
    setEnrolledIds(new Set((enrolled ?? []).map((c) => c.catalogue_course_id)))
    setLoading(false)
  }

  async function handleEnrol(course) {
    setError(null)
    setEnrollingId(course.id)
    try {
      const { error: insertError } = await supabase.from('courses').insert({
        user_id: user.id,
        name: course.name,
        provider: course.provider,
        course_type: course.course_type,
        duration: course.duration,
        catalogue_course_id: course.id,
      })
      if (insertError) throw insertError
      setEnrolledIds((prev) => new Set(prev).add(course.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setEnrollingId(null)
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = catalogue.filter(
    (c) => !q || [c.name, c.provider, c.synopsis].filter(Boolean).some((v) => v.toLowerCase().includes(q))
  )

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="font-display text-xl text-ink mb-2">Find training</h2>
        <p className="text-sm text-secondary mb-6">
          Browse the course catalogue and enrol in something new — enrolling adds it to your training record.
        </p>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, provider or topic…"
          className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-moss"
        />

        {error && <p className="text-sm text-red-700 mb-4">{error}</p>}
        {loading && <p className="text-secondary">Loading…</p>}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No courses match your search.</p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {filtered.map((course) => {
            const enrolled = enrolledIds.has(course.id)
            return (
              <div key={course.id} className="bg-card border border-hairline rounded-lg p-4 flex flex-col">
                <h3 className="font-display text-lg text-ink">{course.name}</h3>
                <p className="font-mono text-xs text-secondary mt-0.5">
                  {[course.provider, course.course_type, course.duration].filter(Boolean).join(' · ')}
                </p>
                {course.synopsis && <p className="text-sm text-secondary mt-2 flex-1">{course.synopsis}</p>}
                <button
                  type="button"
                  onClick={() => handleEnrol(course)}
                  disabled={enrolled || enrollingId === course.id}
                  className="mt-3 self-start rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {enrolled ? 'Enrolled ✓' : enrollingId === course.id ? 'Enrolling…' : 'Enrol'}
                </button>
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
