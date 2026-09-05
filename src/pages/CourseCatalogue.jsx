import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import {
  listCatalogueCourses,
  listEnrolledCatalogueIds,
  enrolInCatalogueCourse,
  formatCoursePrice,
  listCourseCohorts,
  enrolInCourseCohort,
} from '../lib/courseCatalogue'
import { LEVEL_LABELS } from '../lib/levels'
import AppHeader from '../components/AppHeader'
import FilterRow from '../components/FilterRow'
import CourseThumbnail from '../components/CourseThumbnail'
import AccessibleDialog from '../components/AccessibleDialog'
import CohortPickerModal from '../components/CohortPickerModal'

export default function CourseCatalogue() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const scope = location.state ?? null

  const [catalogue, setCatalogue] = useState([])
  const [enrolledIds, setEnrolledIds] = useState(new Map())
  const [mySkills, setMySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [enrollingId, setEnrollingId] = useState(null)

  const [tagId, setTagId] = useState(null)
  const [catalogueId, setCatalogueId] = useState(null)
  const [skillId, setSkillId] = useState(scope?.librarySkillId ?? null)
  const [level, setLevel] = useState(null)
  const [myLevel, setMyLevel] = useState(null)
  // Only set when arriving scoped to a skill (via the skill-not-yet-achieved
  // deep link) -- cleared as soon as the user browses away from that skill.
  const [minLevel, setMinLevel] = useState(
    scope?.librarySkillId ? (scope.skillLevel ?? 0) + 1 : null
  )
  // Filters start collapsed even when arriving scoped to a skill -- the
  // scoping still applies (see minLevel/skillId above), it's just not shown
  // expanded by default.
  const [showFilters, setShowFilters] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState(null)
  // Set once a course with at least one cohort is about to be enrolled into
  // -- shows CohortPickerModal instead of enrolling directly. null means no
  // picker is open (either the course has no cohorts, so enrolment already
  // went straight through, or nothing is in flight).
  const [cohortPicker, setCohortPicker] = useState(null)
  const [cohortEnrolling, setCohortEnrolling] = useState(false)
  const [cohortError, setCohortError] = useState(null)

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
      // Only link the enrolment to the skill it was found from if the
      // course actually covers that skill -- otherwise a course reached via
      // "Browse all courses" from a skill's page could get silently
      // attached to a skill it has nothing to do with.
      const matchesScopedSkill =
        scope?.librarySkillId && course.skillEntries.some((e) => e.skillId === scope.librarySkillId)
      const linkSkillId = matchesScopedSkill ? scope.skillId : null

      // A course with any cohorts defined enrols via a specific one instead
      // of the plain catalogue insert below -- purely additive, a course
      // with no cohorts (the overwhelming majority) falls straight through
      // to the unchanged enrolInCatalogueCourse path.
      const cohorts = await listCourseCohorts(course.id)
      if (cohorts.length > 0) {
        setCohortError(null)
        setCohortPicker({ course, linkSkillId, cohorts })
        return
      }

      const enrolled = await enrolInCatalogueCourse(user.id, course, linkSkillId)
      setEnrolledIds((prev) => new Map(prev).set(course.id, { id: enrolled.id, completedDate: enrolled.completed_date }))
      if (linkSkillId && scope?.backTo) {
        navigate(scope.backTo)
        return
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setEnrollingId(null)
    }
  }

  async function handleCohortEnrol(cohortId) {
    const { course, linkSkillId } = cohortPicker
    setCohortError(null)
    setCohortEnrolling(true)
    try {
      const enrolled = await enrolInCourseCohort(cohortId, linkSkillId)
      setEnrolledIds((prev) => new Map(prev).set(course.id, { id: enrolled.id, completedDate: enrolled.completed_date }))
      setCohortPicker(null)
      if (linkSkillId && scope?.backTo) {
        navigate(scope.backTo)
      }
    } catch (err) {
      setCohortError(err.message)
    } finally {
      setCohortEnrolling(false)
    }
  }

  function handleCardClick(course) {
    const enrollment = enrolledIds.get(course.id)
    if (enrollment) {
      navigate(`/courses/${enrollment.id}/learn`, { state: { backTo: '/training', backLabel: 'Training' } })
      return
    }
    setSelectedCourse(course)
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

  const availableCatalogues = useMemo(() => {
    const map = new Map()
    for (const course of catalogue) for (const item of course.catalogues ?? []) map.set(item.id, item.name)
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [catalogue])

  const myLibrarySkillIds = useMemo(() => new Set(mySkills.map((s) => s.library_skill_id)), [mySkills])

  const activeFilterCount = [catalogueId, tagId, skillId, level, myLevel].filter((v) => v !== null).length

  const q = query.trim().toLowerCase()
  const filtered = catalogue.filter((course) => {
    if (q && ![course.name, course.provider, course.synopsis].filter(Boolean).some((v) => v.toLowerCase().includes(q))) {
      return false
    }
    if (tagId && !course.tags.some((t) => t.id === tagId)) return false
    if (catalogueId && !(course.catalogues ?? []).some((item) => item.id === catalogueId)) return false
    if (skillId) {
      const entries = course.skillEntries.filter((e) => e.skillId === skillId)
      if (entries.length === 0) return false
      if (level && !entries.some((e) => e.level === level)) return false
      if (minLevel && !entries.some((e) => e.level >= minLevel)) return false
    } else if (level && !course.skillEntries.some((e) => e.level === level)) {
      return false
    }
    if (myLevel && !course.skillEntries.some((e) => myLibrarySkillIds.has(e.skillId) && e.level === myLevel)) {
      return false
    }
    return true
  })

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        {scope?.backTo && (
          <Link to={scope.backTo} className="text-sm text-secondary hover:text-ink mb-4 inline-block">
            ← Back to {scope.skillName ?? 'skill'}
          </Link>
        )}

        <h1 className="font-display text-xl text-ink mb-2">Find training</h1>
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
          aria-label="Search training"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, provider or topic…"
          className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-ink text-sm mb-6 focus:outline-none focus:ring-2 focus:ring-moss"
        />

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="text-sm text-moss font-medium mb-4"
        >
          {showFilters ? 'Hide filters' : `Show filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
        </button>

        {showFilters && (
          <div className="space-y-3 mb-6 bg-card border border-hairline rounded-lg p-4">
            <FilterRow
              label="Catalogue"
              value={catalogueId}
              onChange={setCatalogueId}
              options={availableCatalogues.map((item) => ({ value: item.id, label: item.name }))}
            />
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
                value={myLevel}
                onChange={setMyLevel}
                options={Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value: Number(value), label }))}
              />
            )}
            <FilterRow
              label="Target level"
              value={level}
              onChange={setLevel}
              options={Object.entries(LEVEL_LABELS).map(([value, label]) => ({ value: Number(value), label }))}
            />
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-700 mb-4">{error}</p>}
        {loading && <p role="status" className="text-secondary">Loading…</p>}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
            <p className="text-secondary">No courses match your filters.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((course) => {
            const enrollment = enrolledIds.get(course.id)
            const enrolled = Boolean(enrollment)
            const completed = Boolean(enrollment?.completedDate)
            return (
              <div
                key={course.id}
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(course)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleCardClick(course)
                  }
                }}
                className="bg-card border border-hairline rounded-lg overflow-hidden flex flex-col cursor-pointer hover:border-moss transition-colors"
              >
                <CourseThumbnail
                  name={course.name}
                  provider={course.provider}
                  logoUrl={course.logoUrl}
                  imageUrl={course.image_url}
                  className="h-24 w-full shrink-0"
                />
                <div className="p-4 flex flex-col flex-1">
                  <h3 className="font-display text-lg text-ink">{course.name}</h3>
                  {(course.catalogues ?? []).length > 0 && (
                    <p className="text-[11px] text-moss mt-1">{course.catalogues.map((item) => item.name).join(' · ')}</p>
                  )}
                  <p className="font-mono text-xs text-secondary mt-0.5">
                    {course.provider &&
                      (course.providerSlug ? (
                        <Link
                          to={`/providers/${course.providerSlug}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-moss hover:underline"
                        >
                          {course.provider}
                        </Link>
                      ) : (
                        course.provider
                      ))}
                    {course.provider && (course.course_type || course.duration || formatCoursePrice(course)) && ' · '}
                    {[course.course_type, course.duration, formatCoursePrice(course)].filter(Boolean).join(' · ')}
                  </p>
                  {course.synopsis && <p className="text-sm text-secondary mt-2 flex-1">{course.synopsis}</p>}
                  {(course.skillEntries.length > 0 || course.tags.length > 0) && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {course.skillEntries.map((e) => (
                        <span
                          key={e.skillId}
                          className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5"
                        >
                          {e.skillName} · {LEVEL_LABELS[e.level]}{e.isComposite ? ' · Composite' : ''}
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
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEnrol(course)
                    }}
                    disabled={enrolled || enrollingId === course.id}
                    className="mt-3 self-start rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {completed
                      ? 'Completed ✓'
                      : enrolled
                        ? 'Enrolled ✓'
                        : enrollingId === course.id
                          ? 'Enrolling…'
                          : 'Enrol'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {selectedCourse && (
        <CourseDetailModal
          course={selectedCourse}
          enrolled={enrolledIds.has(selectedCourse.id)}
          completed={Boolean(enrolledIds.get(selectedCourse.id)?.completedDate)}
          enrolling={enrollingId === selectedCourse.id}
          onEnrol={() => handleEnrol(selectedCourse)}
          onClose={() => setSelectedCourse(null)}
        />
      )}

      {cohortPicker && (
        <CohortPickerModal
          courseName={cohortPicker.course.name}
          cohorts={cohortPicker.cohorts}
          enrolling={cohortEnrolling}
          error={cohortError}
          onEnrol={handleCohortEnrol}
          onClose={() => setCohortPicker(null)}
        />
      )}
    </div>
  )
}

function CourseDetailModal({ course, enrolled, completed, enrolling, onEnrol, onClose }) {
  return (
    <AccessibleDialog
      labelledBy="catalogue-course-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-2 gap-4">
          <h2 id="catalogue-course-dialog-title" className="font-display text-xl text-ink">{course.name}</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>
        <p className="font-mono text-xs text-secondary mb-3">
          {course.provider &&
            (course.providerSlug ? (
              <Link to={`/providers/${course.providerSlug}`} className="hover:text-moss hover:underline">
                {course.provider}
              </Link>
            ) : (
              course.provider
            ))}
          {course.provider && (course.course_type || course.duration || formatCoursePrice(course)) && ' · '}
          {[course.course_type, course.duration, formatCoursePrice(course)].filter(Boolean).join(' · ')}
        </p>
        {course.synopsis && <p className="text-sm text-ink mb-4">{course.synopsis}</p>}
        {(course.skillEntries.length > 0 || course.tags.length > 0) && (
          <div className="flex flex-wrap gap-1 mb-4">
            {course.skillEntries.map((e) => (
              <span
                key={e.skillId}
                className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5"
              >
                {e.skillName} · {LEVEL_LABELS[e.level]}{e.isComposite ? ` · Composite (${e.componentCount})` : ''}
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
          onClick={onEnrol}
          disabled={enrolled || enrolling}
          className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {completed ? 'Completed ✓' : enrolled ? 'Enrolled ✓' : enrolling ? 'Enrolling…' : 'Enrol'}
        </button>
    </AccessibleDialog>
  )
}
