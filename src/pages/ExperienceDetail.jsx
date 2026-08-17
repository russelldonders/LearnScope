import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatMonthYear } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import { EXPERIENCE_TYPE_LABELS, EXPERIENCE_TYPE_CONFIG, NESTED_EXPERIENCE_TYPES } from '../lib/experienceTypes'
import AppHeader from '../components/AppHeader'
import GrowthRing from '../components/GrowthRing'
import SkillCard from '../components/SkillCard'
import FindSkillModal from '../components/FindSkillModal'
import OrganizationLogo from '../components/OrganizationLogo'
import OrganizationUrlField from '../components/OrganizationUrlField'
import ExperienceModal from '../components/ExperienceModal'
import AddExperienceButton from '../components/AddExperienceButton'

const NESTABLE_PARENT_TYPES = ['employment', 'volunteer']

// Keeps a nested project/course/other experience's dates from silently
// drifting outside the parent role's dates -- an open-ended parent
// (end_date null) places no upper bound on its children.
function validateWithinParent(values, parent) {
  if (!parent) return null
  if (values.start_date < parent.start_date) {
    return `Start date can't be before ${formatMonthYear(parent.start_date)}, when "${parent.title}" started.`
  }
  if (parent.end_date) {
    if (values.start_date > parent.end_date) {
      return `Start date can't be after ${formatMonthYear(parent.end_date)}, when "${parent.title}" ended.`
    }
    if (!values.end_date || values.end_date > parent.end_date) {
      return `End date can't be after ${formatMonthYear(parent.end_date)}, when "${parent.title}" ended.`
    }
  }
  return null
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'courses', label: 'Courses' },
  { id: 'skills', label: 'Skills' },
  { id: 'details', label: 'Details' },
]

export default function ExperienceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [item, setItem] = useState(null)
  const [loadingItem, setLoadingItem] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState(location.state?.tab ?? 'overview')
  const [linkedCourses, setLinkedCourses] = useState([])
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [learningLoaded, setLearningLoaded] = useState(false)
  const [childExperiences, setChildExperiences] = useState([])
  const [parentExperience, setParentExperience] = useState(null)
  const [childModalType, setChildModalType] = useState(null)

  useEffect(() => {
    loadItem()
  }, [id])

  useEffect(() => {
    if (item) {
      loadLearning()
      loadRelated()
    }
  }, [item?.id])

  async function loadItem() {
    setLoadingItem(true)
    setNotFound(false)
    const { data, error } = await supabase
      .from('experience')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
    } else {
      setItem(data)
    }
    setLoadingItem(false)
  }

  async function loadLearning() {
    const [{ data: cl }, { data: sl }, { data: ach }] = await Promise.all([
      supabase
        .from('course_experience_links')
        .select('id, course_id, courses(id, name, provider, completed_date)')
        .eq('experience_id', item.id),
      supabase
        .from('skill_experience_links')
        .select('id, skill_id, skills(id, name)')
        .eq('experience_id', item.id)
        .order('created_at'),
      supabase
        .from('skill_assessments')
        .select('*, skills(name), courses(name)')
        .eq('experience_id', item.id)
        .order('assessed_at', { ascending: false }),
    ])
    setLinkedCourses(cl ?? [])
    setSkillLinks(sl ?? [])
    setAchievements(ach ?? [])
    setLearningLoaded(true)
  }

  async function loadRelated() {
    const [{ data: children }, parentResult] = await Promise.all([
      supabase
        .from('experience')
        .select('id, type, title, start_date, end_date')
        .eq('parent_experience_id', item.id)
        .order('start_date', { ascending: false }),
      item.parent_experience_id
        ? supabase
            .from('experience')
            .select('id, title, start_date, end_date')
            .eq('id', item.parent_experience_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setChildExperiences(children ?? [])
    setParentExperience(parentResult.data ?? null)
  }

  async function handleAddChildExperience(values) {
    const validationError = validateWithinParent(values, item)
    if (validationError) throw new Error(validationError)
    const { error } = await supabase.from('experience').insert({
      ...values,
      user_id: user.id,
      parent_experience_id: item.id,
    })
    if (error) throw error
    setChildModalType(null)
    await loadRelated()
  }

  async function handleSaveDetails(values) {
    if (item.parent_experience_id && parentExperience) {
      const validationError = validateWithinParent(values, parentExperience)
      if (validationError) throw new Error(validationError)
    }
    const { error } = await supabase.from('experience').update(values).eq('id', item.id)
    if (error) throw error
    await loadItem()
  }

  async function handleDelete() {
    const { error } = await supabase.from('experience').delete().eq('id', item.id)
    if (error) throw error
    navigate('/experience')
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/experience" className="text-sm text-secondary hover:text-ink mb-6 inline-block">
          ← Back to experience
        </Link>

        {loadingItem && <p className="text-secondary">Loading…</p>}
        {notFound && <p className="text-secondary">Experience not found.</p>}

        {item && (
          <div className="bg-card border border-hairline rounded-lg p-6">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
              {EXPERIENCE_TYPE_LABELS[item.type] ?? item.type}
            </span>
            <h2 className="font-display text-2xl text-ink mt-0.5">{item.title}</h2>
            {item.organization && (
              <div className="flex items-center gap-2 mt-0.5">
                {item.organization_url && <OrganizationLogo organizationUrl={item.organization_url} size={24} />}
                <p className="text-sm text-secondary">{item.organization}</p>
              </div>
            )}
            {parentExperience && (
              <p className="text-xs text-secondary mt-1">
                Part of{' '}
                <Link to={`/experience/${parentExperience.id}`} className="text-moss hover:underline">
                  {parentExperience.title}
                </Link>
              </p>
            )}

            {NESTABLE_PARENT_TYPES.includes(item.type) && (
              <div className="mt-4">
                <AddExperienceButton
                  types={NESTED_EXPERIENCE_TYPES}
                  onSelect={setChildModalType}
                  label="+ Add Experience"
                />
              </div>
            )}

            {childModalType && (
              <ExperienceModal
                type={childModalType}
                initialOrganization={item.organization ?? ''}
                initialOrganizationUrl={item.organization_url ?? ''}
                onSave={handleAddChildExperience}
                onClose={() => setChildModalType(null)}
              />
            )}

            <div className="flex items-center gap-1 border-b border-hairline mt-4 mb-4 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === t.id
                      ? 'border-moss text-ink'
                      : 'border-transparent text-secondary hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <OverviewTab
                item={item}
                linkedCourses={linkedCourses}
                skillLinks={skillLinks}
                achievements={achievements}
                childExperiences={childExperiences}
                loaded={learningLoaded}
              />
            )}

            {tab === 'courses' && (
              <CoursesSubsection item={item} linkedCourses={linkedCourses} onChange={loadLearning} />
            )}

            {tab === 'skills' && (
              <SkillsSubsection item={item} skillLinks={skillLinks} onChange={loadLearning} user={user} />
            )}

            {tab === 'details' && (
              <DetailsTab item={item} onSave={handleSaveDetails} onDelete={handleDelete} />
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function DetailsTab({ item, onSave, onDelete }) {
  const [type, setType] = useState(item.type)
  const [title, setTitle] = useState(item.title)
  const [organization, setOrganization] = useState(item.organization ?? '')
  const [organizationUrl, setOrganizationUrl] = useState(item.organization_url ?? '')
  const [startDate, setStartDate] = useState(item.start_date ?? '')
  const [endDate, setEndDate] = useState(item.end_date ?? '')
  const [current, setCurrent] = useState(!item.end_date)
  const [description, setDescription] = useState(item.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const config = EXPERIENCE_TYPE_CONFIG[type] ?? EXPERIENCE_TYPE_CONFIG.employment

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || (config.orgRequired && !organization.trim()) || !startDate) {
      setError(`Title${config.orgRequired ? ', organization,' : ''} and start date are required.`)
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        type,
        title: title.trim(),
        organization: organization.trim() || null,
        organization_url: organizationUrl.trim() || null,
        start_date: startDate,
        end_date: current ? null : endDate || null,
        description: description.trim() || null,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return
    setSaving(true)
    try {
      await onDelete()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {item.type === 'education' && (
        <div>
          <span className="block text-sm text-secondary mb-2">Type</span>
          <div className="flex gap-2">
            {[
              { value: 'employment', label: 'Employment' },
              { value: 'education', label: 'Education' },
            ].map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  type === opt.value
                    ? 'bg-moss text-paper border-moss'
                    : 'border-hairline text-ink hover:bg-paper'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-secondary mt-1">
            Education entries are now recorded under Courses — this one is kept as-is since it
            already exists.
          </p>
        </div>
      )}

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="title">
          {config.titleLabel}
        </label>
        <input
          id="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="organization">
          {config.orgLabel}
        </label>
        <input
          id="organization"
          required={config.orgRequired}
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      <OrganizationUrlField value={organizationUrl} onChange={setOrganizationUrl} />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="startDate">
            Start date
          </label>
          <input
            id="startDate"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>
        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="endDate">
            End date
          </label>
          <input
            id="endDate"
            type="date"
            disabled={current}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-50"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={current}
          onChange={(e) => setCurrent(e.target.checked)}
          className="rounded border-hairline"
        />
        This is ongoing / current
      </label>

      <div>
        <label className="block text-sm text-secondary mb-1" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Responsibilities, achievements, focus areas…"
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save details'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={saving}
          className="rounded-md border border-hairline text-red-700 py-1.5 px-3 text-sm hover:bg-paper disabled:opacity-60"
        >
          Delete experience
        </button>
      </div>
    </form>
  )
}

function OverviewTab({ item, linkedCourses, skillLinks, achievements, childExperiences, loaded }) {
  const navigate = useNavigate()
  if (!loaded) return <p className="text-sm text-secondary">Loading…</p>

  function goToCourse(courseId) {
    navigate(`/courses/${courseId}`, { state: { backTo: `/experience/${item.id}`, backLabel: item.title } })
  }

  const pendingCourseLinks = linkedCourses.filter((l) => l.courses && !l.courses.completed_date)
  const events = [
    { type: 'start', date: item.start_date },
    item.end_date ? { type: 'end', date: item.end_date } : { type: 'today', date: new Date().toISOString() },
    ...(childExperiences ?? []).map((c) => ({ type: 'child', date: c.start_date, child: c })),
    ...linkedCourses
      .filter((l) => l.courses?.completed_date)
      .map((l) => ({ type: 'course', date: l.courses.completed_date, link: l })),
    ...achievements.map((a) => ({ type: 'achievement', date: a.assessed_at, entry: a })),
  ].sort((a, b) =>
    new Date(b.date).toISOString().slice(0, 10).localeCompare(new Date(a.date).toISOString().slice(0, 10))
  )
  const total = pendingCourseLinks.length + events.length

  return (
    <div className="space-y-6">
      {item.description && <p className="text-sm text-ink whitespace-pre-line">{item.description}</p>}

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Timeline</h4>
        {pendingCourseLinks.map((link, i) => (
          <PendingCourseEntry
            key={link.id}
            link={link}
            hasMore={i < total - 1}
            onClick={() => goToCourse(link.courses.id)}
          />
        ))}
        {events.map((event, i) => (
          <ExperienceTimelineEntry
            key={event.child?.id ?? event.link?.id ?? event.entry?.id ?? event.type}
            item={item}
            event={event}
            isLast={pendingCourseLinks.length + i === total - 1}
            onSelectCourse={goToCourse}
          />
        ))}
      </div>

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">Skills developed</h4>
        {skillLinks.length === 0 ? (
          <p className="text-sm text-secondary">No skills linked yet.</p>
        ) : (
          <ul className="space-y-1">
            {skillLinks.map((l) => (
              <li key={l.skill_id} className="text-sm text-ink">
                {l.skills?.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PendingCourseEntry({ link, hasMore, onClick }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-hairline">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40" />
        </div>
        {hasMore && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper/60 p-3 cursor-pointer hover:border-moss/60 transition-colors"
      >
        <p className="text-sm text-secondary">
          Enrolled in <span className="text-ink font-medium">{link.courses.name}</span> — in progress
        </p>
      </div>
    </div>
  )
}

function FlagIcon({ className }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 3v18" />
      <path d="M5 4h13l-2.5 4.5L18 13H5" />
    </svg>
  )
}

function ExperienceTimelineEntry({ item, event, isLast, onSelectCourse }) {
  if (event.type === 'start' || event.type === 'end') {
    const config = EXPERIENCE_TYPE_CONFIG[item.type] ?? EXPERIENCE_TYPE_CONFIG.employment
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-hairline bg-paper">
            <FlagIcon className="text-secondary" />
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
          <p className="text-sm font-medium text-ink capitalize">
            {event.type === 'start' ? `${config.periodNoun} started` : `${config.periodNoun} ended`}
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">{formatMonthYear(event.date)}</p>
        </div>
      </div>
    )
  }

  if (event.type === 'today') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-ink shrink-0" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink font-semibold">
            Today · {new Date(event.date).toLocaleDateString()}
          </span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
      </div>
    )
  }

  if (event.type === 'child') {
    const { child } = event
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <Link
          to={`/experience/${child.id}`}
          className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary hover:text-ink transition-colors"
        >
          <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">
            {EXPERIENCE_TYPE_LABELS[child.type] ?? child.type}
          </span>
          <span className="truncate text-ink">{child.title}</span>
          <span className="font-mono text-[10px] text-secondary/70 shrink-0">
            {formatMonthYear(child.start_date)}
            {child.end_date ? ` – ${formatMonthYear(child.end_date)}` : ''}
          </span>
        </Link>
      </div>
    )
  }

  if (event.type === 'course') {
    const course = event.link.courses
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelectCourse(course.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelectCourse(course.id)
            }
          }}
          className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary cursor-pointer hover:text-ink transition-colors"
        >
          <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">Training</span>
          <span className="truncate">{course.name}</span>
          <span className="font-mono text-[10px] text-secondary/70 shrink-0">
            {new Date(course.completed_date).toLocaleDateString()}
          </span>
        </div>
      </div>
    )
  }

  const entry = event.entry
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <GrowthRing level={entry.level} size={32} />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
        <p className="text-sm font-medium text-ink">
          {entry.skills?.name} <span className="text-secondary font-normal">· {LEVEL_LABELS[entry.level]}</span>
        </p>
        <p className="font-mono text-xs text-secondary mt-0.5">{new Date(entry.assessed_at).toLocaleDateString()}</p>
        {entry.comments && <p className="text-sm text-ink mt-1">{entry.comments}</p>}
      </div>
    </div>
  )
}

function CoursesSubsection({ item, linkedCourses, onChange }) {
  const [error, setError] = useState(null)

  async function unlinkCourse(linkId) {
    setError(null)
    const { error } = await supabase.from('course_experience_links').delete().eq('id', linkId)
    if (error) setError(error.message)
    else await onChange()
  }

  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Courses</h4>

      {linkedCourses.length === 0 ? (
        <p className="text-sm text-secondary mb-3">No courses linked yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {linkedCourses
            .filter((l) => l.courses)
            .map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-2 bg-paper border border-hairline rounded-md px-3 py-2"
              >
                <Link
                  to={`/courses/${l.courses.id}`}
                  state={{ backTo: `/experience/${item.id}`, backLabel: item.title }}
                  className="min-w-0"
                >
                  <p className="text-sm text-ink truncate hover:underline">{l.courses.name}</p>
                  {l.courses.completed_date && (
                    <p className="font-mono text-xs text-secondary">
                      Completed {formatMonthYear(l.courses.completed_date)}
                    </p>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => unlinkCourse(l.id)}
                  className="shrink-0 text-xs text-red-700 font-medium"
                >
                  Unlink
                </button>
              </li>
            ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  )
}

function SkillsSubsection({ item, skillLinks, onChange, user }) {
  const navigate = useNavigate()
  const [skills, setSkills] = useState([])
  const [tagsBySkill, setTagsBySkill] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  const skillIds = [...new Set(skillLinks.map((l) => l.skill_id))]

  useEffect(() => {
    loadSkills()
  }, [skillLinks])

  async function loadSkills() {
    if (skillIds.length === 0) {
      setSkills([])
      setTagsBySkill(new Map())
      setLoading(false)
      return
    }
    setLoading(true)
    const [{ data: skillRows }, { data: tagLinks }] = await Promise.all([
      supabase.from('skills').select('*').eq('user_id', user.id).in('id', skillIds),
      supabase.from('skill_tags').select('skill_id, tags(name)').eq('user_id', user.id).in('skill_id', skillIds),
    ])
    setSkills(skillRows ?? [])
    const map = new Map()
    for (const link of tagLinks ?? []) {
      if (!link.tags?.name) continue
      if (!map.has(link.skill_id)) map.set(link.skill_id, [])
      map.get(link.skill_id).push(link.tags.name)
    }
    setTagsBySkill(map)
    setLoading(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary">Skills</h4>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          + Find skill
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="text-sm text-secondary">No skills linked yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              tags={tagsBySkill.get(skill.id)}
              onEdit={(s) =>
                navigate(`/skills/${s.id}`, {
                  state: { from: `/experience/${item.id}`, fromLabel: item.title },
                })
              }
            />
          ))}
        </div>
      )}

      {addOpen && (
        <FindSkillModal
          experienceId={item.id}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false)
            onChange()
          }}
        />
      )}
    </div>
  )
}
