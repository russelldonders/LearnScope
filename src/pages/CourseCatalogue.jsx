import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { listCatalogueCourses, listEnrolledCatalogueIds, enrolInCatalogueCourse } from '../lib/courseCatalogue'
import { LEVEL_LABELS } from '../lib/levels'
import AppHeader from '../components/AppHeader'

export default function CourseCatalogue() {
  const { user } = useAuth()
  const location = useLocation()
  const scope = location.state ?? null

  const [catalogue, setCatalogue] = useState([])
  const [enrolledIds, setEnrolledIds] = useState(new Set())
  const [mySkills, setMySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [enrollingId, setEnrollingId] = useState(null)

  const [tagId, setTagId] = useState(null)
  const [skillId, setSkillId] = useState(scope?.librarySkillId ?? null)
  const [level, setLevel] = useState(null)
  // Only set when arriving scoped to a skill (via the skill-not-yet-achieved
  // deep link) -- cleared as soon as the user browses away from that skill.
  const [minLevel, setMinLevel] = useState(
    scope?.librarySkillId ? (scope.skillLevel ?? 0) + 1 : null
  )

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [catalogueData, enrolled, { data: skillsData }] = await Promise.all([
        listCatalogueCourses(),
        listEnrolledCatalogueIds(user.id),
        supabase
          .from('skills')
          .select('id, name, level, library_skill_id')
          .eq('user_id', user.id)
          .not('library_skill_id', 'is', null)
          .order('name'),
      ])
      setCatalogue(catalogueData)
      setEnrolledIds(enrolled)
      setMySkills(skillsData ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleEnrol(course) {
    setError(null)
    setEnrollingId(course.id)
    try {
      await enrolInCatalogueCourse(user.id, course)
      setEnrolledIds((prev) => new Set(prev).add(course.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setEnrollingId(null)
    }
  }

  function handleSelectSkill(id) {
    setSkillId(id)
    setMinLevel(null)
  }

  function handleBrowseAll() {
    setSkillId(null)
    setMinLevel(null)
  }

  const availableTags = useMemo(() => {
    const map = new Map()
    for (const c of catalogue) for (const t of c.tags) map.set(t.id, t.name)
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [catalogue])

  const availableSkills = useMemo(() => {
    const map = new Map()
    for (const c of catalogue) for (const s of c.skillEntries) map.set(s.skillId, s.skillName)
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [catalogue])

  const q = query.trim().toLowerCase()
  const filtered = catalogue.filter((course) => {
    if (q && ![course.name, course.provider, course.synopsis].filter(Boolean).some((v) => v.toLowerCase().includes(q))) {
      return false
    }
    if (tagId && !course.tags.some((t) => t.id === tagId)) return false
    if (skillId) {
      const entries = course.skillEntries.filter((e) => e.skillId === skillId)
      if (entries.length === 0) return false
      if (level && !entries.some((e) => e.level === level)) return false
      if (minLevel && !entries.some((e) => e.level >= minLevel)) return false
    } else if (level && !course.skillEntries.some((e) => e.level === level)) {
      return false
    }
    return true
  })

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8">
        {scope?.backTo && (
          <Link to={scope.backTo} className="text-sm text-secondary hover:text-ink mb-4 inline-block">
            ← Back to {scope.skillName ?? 'skill'}
          </Link>
        )}

        <h2 className="font-display text-xl text-ink mb-2">Find training</h2>
        <p className="text-sm text-secondary mb-6">
          Browse the course catalogue and enrol in something new — enrolling adds it to your training record.
        </p>

        {scope?.skillName && (skillId || minLevel) && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-moss/40 bg-moss/5 px-3 py-2 mb-4">
            <p className="text-sm text-ink">
              Showing courses for <span className="font-medium">{scope.skillName}</span>
              {minLevel ? ` at levels you haven't reached yet` : ''}
            </p>
            <button type="button" onClick={handleBrowseAll} className="shrink-0 text-xs text-moss font-medium">
              Browse all courses
            </button>
          </div>
        )}

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, provider or topic…"
          className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-moss"
        />

        <div className="space-y-3 mb-6">
          <FilterRow
            label="Category tag"
            value={tagId}
            onChange={setTagId}
            options={availableTags.map((t) => ({ value: t.id, label: t.name }))}
          />
          <FilterRow
            label="Skill"
            value={skillId}
            onChange={handleSelectSkill}
            options={availableSkills.map((s) => ({ value: s.id, label: s.name }))}
          />
          {mySkills.length > 0 && (
            <FilterRow
              label="My skill entry"
              value={mySkills.some((s) => s.library_skill_id === skillId) ? skillId : null}
              onChange={handleSelectSkill}
              options={mySkills.map((s) => ({ value: s.library_skill_id, label: s.name }))}
            />
          )}
          <FilterRow
            label="Target level"
            value={level}
            onChange={setLevel}
            options={Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value: Number(value), label }))}
          />
        </div>

        {error && <p className="text-sm text-red-700 mb-4">{error}</p>}
        {loading && <p className="text-secondary">Loading…</p>}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No courses match your filters.</p>
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
                {(course.skillEntries.length > 0 || course.tags.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {course.skillEntries.map((e) => (
                      <span
                        key={e.skillId}
                        className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5"
                      >
                        {e.skillName} · {LEVEL_LABELS[e.level]}
                      </span>
                    ))}
                    {course.tags.map((t) => (
                      <span
                        key={t.id}
                        className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
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

function FilterRow({ label, value, onChange, options }) {
  if (options.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary w-28 shrink-0">{label}</span>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
          value === null ? 'bg-moss text-paper border-moss' : 'border-hairline text-secondary hover:text-ink'
        }`}
      >
        Any
      </button>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(value === o.value ? null : o.value)}
          className={`font-mono text-xs uppercase tracking-wide rounded-full px-3 py-1 border transition-colors ${
            value === o.value ? 'bg-moss text-paper border-moss' : 'border-hairline text-secondary hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
