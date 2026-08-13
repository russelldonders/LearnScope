import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatMonthYear } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import { SKILL_RELATIONSHIP_LABELS } from '../lib/skillRelationships'
import AppHeader from '../components/AppHeader'
import SkillCard from '../components/SkillCard'
import SkillModal from '../components/SkillModal'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'courses', label: 'Courses' },
  { id: 'skills', label: 'Skills' },
  { id: 'details', label: 'Details' },
]

export default function ExperienceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [item, setItem] = useState(null)
  const [loadingItem, setLoadingItem] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState('overview')
  const [courses, setCourses] = useState([])
  const [linkedCourses, setLinkedCourses] = useState([])
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [learningLoaded, setLearningLoaded] = useState(false)

  useEffect(() => {
    loadItem()
    loadPickerData()
  }, [id])

  useEffect(() => {
    if (item) loadLearning()
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

  async function loadPickerData() {
    const { data: coursesData } = await supabase
      .from('courses')
      .select('id, name, provider, completed_date')
      .order('name')
    setCourses(coursesData ?? [])
  }

  async function loadLearning() {
    const [{ data: cl }, { data: sl }, { data: ach }] = await Promise.all([
      supabase
        .from('course_experience_links')
        .select('id, course_id, courses(id, name, provider, completed_date)')
        .eq('experience_id', item.id),
      supabase
        .from('skill_experience_links')
        .select('id, skill_id, relationship, skills(id, name)')
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

  async function handleSaveDetails(values) {
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
              {item.type === 'education' ? 'Education' : 'Employment'}
            </span>
            <h2 className="font-display text-2xl text-ink mt-0.5">{item.title}</h2>
            <p className="text-sm text-secondary">{item.organization}</p>

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
                loaded={learningLoaded}
              />
            )}

            {tab === 'courses' && (
              <CoursesSubsection
                item={item}
                courses={courses}
                linkedCourses={linkedCourses}
                onChange={loadLearning}
                user={user}
              />
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
  const [organization, setOrganization] = useState(item.organization)
  const [startDate, setStartDate] = useState(item.start_date ?? '')
  const [endDate, setEndDate] = useState(item.end_date ?? '')
  const [current, setCurrent] = useState(!item.end_date)
  const [description, setDescription] = useState(item.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !organization.trim() || !startDate) {
      setError('Title, organization, and start date are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        type,
        title: title.trim(),
        organization: organization.trim(),
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
          {type === 'education' ? 'Degree / course title' : 'Role title'}
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
          {type === 'education' ? 'Institution' : 'Company'}
        </label>
        <input
          id="organization"
          required
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

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

function OverviewTab({ item, linkedCourses, skillLinks, achievements, loaded }) {
  if (!loaded) return <p className="text-sm text-secondary">Loading…</p>

  const grouped = []
  const bySkill = new Map()
  for (const l of skillLinks) {
    if (!bySkill.has(l.skill_id)) {
      const entry = { skillId: l.skill_id, name: l.skills?.name, relationships: [] }
      bySkill.set(l.skill_id, entry)
      grouped.push(entry)
    }
    bySkill.get(l.skill_id).relationships.push(l.relationship)
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs text-secondary">
          {formatMonthYear(item.start_date)} – {item.end_date ? formatMonthYear(item.end_date) : 'Present'}
        </p>
        {item.description && (
          <p className="text-sm text-ink mt-2 whitespace-pre-line">{item.description}</p>
        )}
      </div>

      <p className="text-xs text-secondary">
        These are historical records from this {item.type === 'education' ? 'study period' : 'role'} —
        they don't change your current skill levels unless you choose to update them.
      </p>

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">Courses</h4>
        {linkedCourses.length === 0 ? (
          <p className="text-sm text-secondary">No courses linked yet.</p>
        ) : (
          <ul className="space-y-1">
            {linkedCourses.map((l) => (
              <li key={l.id} className="text-sm text-ink">
                {l.courses?.name}
                {l.courses?.completed_date && (
                  <span className="text-secondary"> · Completed {formatMonthYear(l.courses.completed_date)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">Skills developed</h4>
        {grouped.length === 0 ? (
          <p className="text-sm text-secondary">No skills linked yet.</p>
        ) : (
          <ul className="space-y-1">
            {grouped.map((g) => (
              <li key={g.skillId} className="text-sm text-ink">
                {g.name} —{' '}
                <span className="text-secondary">
                  {g.relationships.map((r) => SKILL_RELATIONSHIP_LABELS[r]).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">Skill achievements</h4>
        {achievements.length === 0 ? (
          <p className="text-sm text-secondary">No achievements recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {achievements.map((a) => (
              <li key={a.id} className="text-sm text-ink">
                {a.skills?.name} <span className="text-secondary">· {LEVEL_LABELS[a.level]}</span>{' '}
                <span className="font-mono text-xs text-secondary">
                  ({new Date(a.assessed_at).toLocaleDateString()})
                </span>
                {a.comments && <p className="text-xs text-secondary mt-0.5">{a.comments}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CoursesSubsection({ item, courses, linkedCourses, onChange, user }) {
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState(null)

  const linkedIds = new Set(linkedCourses.map((l) => l.course_id))
  const unlinked = courses.filter((c) => !linkedIds.has(c.id))
  const endBound = item.end_date || new Date().toISOString().slice(0, 10)
  const suggested = unlinked.filter(
    (c) => c.completed_date && c.completed_date >= item.start_date && c.completed_date <= endBound
  )
  const otherOptions = unlinked.filter((c) => !suggested.includes(c))

  async function linkCourse(courseId) {
    if (!courseId) return
    setError(null)
    setLinking(true)
    try {
      const { error } = await supabase.from('course_experience_links').insert({
        user_id: user.id,
        course_id: courseId,
        experience_id: item.id,
      })
      if (error) throw error
      setSelectedCourseId('')
      await onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setLinking(false)
    }
  }

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
          {linkedCourses.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 bg-paper border border-hairline rounded-md px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">{l.courses?.name}</p>
                {l.courses?.completed_date && (
                  <p className="font-mono text-xs text-secondary">
                    Completed {formatMonthYear(l.courses.completed_date)}
                  </p>
                )}
              </div>
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

      {suggested.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-secondary mb-1">Suggested (completed during this period):</p>
          <div className="flex flex-wrap gap-2">
            {suggested.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={linking}
                onClick={() => linkCourse(c.id)}
                className="font-mono text-xs rounded-full px-3 py-1 border border-moss text-moss hover:bg-moss/10 disabled:opacity-60"
              >
                + {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {otherOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedCourseId}
            onChange={(e) => setSelectedCourseId(e.target.value)}
            className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          >
            <option value="">Link another course…</option>
            {otherOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedCourseId || linking}
            onClick={() => linkCourse(selectedCourseId)}
            className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Link
          </button>
        </div>
      )}

      {courses.length === 0 && (
        <p className="text-xs text-secondary">You don't have any courses logged yet.</p>
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
        <button type="button" onClick={() => setAddOpen(true)} className="text-xs text-moss font-medium">
          + Add skill
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
              onEdit={(s) => navigate(`/skills/${s.id}`)}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <SkillModal
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
