import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { findOrCreateLibrarySkill } from '../lib/skillLibrary'
import { formatMonthYear } from '../lib/dates'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'
import { SKILL_RELATIONSHIPS, SKILL_RELATIONSHIP_LABELS } from '../lib/skillRelationships'
import GrowthRing from './GrowthRing'
import EvidenceFields from './EvidenceFields'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'courses', label: 'Courses' },
  { id: 'skills', label: 'Skills' },
  { id: 'details', label: 'Details' },
]

export default function ExperienceModal({ item, skills, courses, librarySkills, onRefreshPickerData, onSave, onDelete, onClose }) {
  const { user } = useAuth()
  const isEditing = Boolean(item?.id)
  const [tab, setTab] = useState('overview')
  const [type, setType] = useState(item?.type ?? 'employment')
  const [title, setTitle] = useState(item?.title ?? '')
  const [organization, setOrganization] = useState(item?.organization ?? '')
  const [startDate, setStartDate] = useState(item?.start_date ?? '')
  const [endDate, setEndDate] = useState(item?.end_date ?? '')
  const [current, setCurrent] = useState(Boolean(item?.id) && !item?.end_date)
  const [description, setDescription] = useState(item?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [linkedCourses, setLinkedCourses] = useState([])
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [learningLoaded, setLearningLoaded] = useState(false)

  useEffect(() => {
    if (!isEditing) return
    loadLearning()
  }, [])

  async function loadLearning() {
    const [{ data: cl }, { data: sl }, { data: ach }] = await Promise.all([
      supabase
        .from('course_experience_links')
        .select('id, course_id, courses(id, name, provider, completed_date)')
        .eq('experience_id', item.id),
      supabase
        .from('skill_experience_links')
        .select('id, skill_id, relationship, skills(id, name, category)')
        .eq('experience_id', item.id)
        .order('created_at'),
      supabase
        .from('skill_assessments')
        .select('*, skills(name, category), courses(name)')
        .eq('experience_id', item.id)
        .order('assessed_at', { ascending: false }),
    ])
    setLinkedCourses(cl ?? [])
    setSkillLinks(sl ?? [])
    setAchievements(ach ?? [])
    setLearningLoaded(true)
  }

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
        id: item?.id,
        type,
        title: title.trim(),
        organization: organization.trim(),
        start_date: startDate,
        end_date: current ? null : endDate || null,
        description: description.trim() || null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return
    setSaving(true)
    try {
      await onDelete(item.id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl text-ink mb-4">
          {isEditing ? 'Edit experience' : 'Add experience'}
        </h2>

        {isEditing && (
          <div className="flex items-center gap-1 border-b border-hairline mb-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                  tab === t.id
                    ? 'border-moss text-ink'
                    : 'border-transparent text-secondary hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {(!isEditing || tab === 'details') && (
          <form onSubmit={handleSubmit} className="space-y-4">
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
            </div>

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
                className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
              >
                Cancel
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="rounded-md border border-hairline text-red-700 py-2 px-4 hover:bg-paper disabled:opacity-60"
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        )}

        {isEditing && tab === 'overview' && (
          <OverviewTab
            item={item}
            linkedCourses={linkedCourses}
            skillLinks={skillLinks}
            achievements={achievements}
            loaded={learningLoaded}
          />
        )}

        {isEditing && tab === 'courses' && (
          <CoursesSubsection
            item={item}
            courses={courses}
            linkedCourses={linkedCourses}
            onChange={loadLearning}
            user={user}
          />
        )}

        {isEditing && tab === 'skills' && (
          <div className="space-y-8">
            <SkillsDevelopedSubsection
              item={item}
              skills={skills}
              skillLinks={skillLinks}
              librarySkills={librarySkills}
              onChange={loadLearning}
              onRefreshPickerData={onRefreshPickerData}
              user={user}
            />

            <AchievementsSubsection
              item={item}
              skills={skills}
              linkedCourses={linkedCourses}
              achievements={achievements}
              librarySkills={librarySkills}
              onChange={loadLearning}
              onRefreshPickerData={onRefreshPickerData}
              user={user}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function OverviewTab({ item, linkedCourses, skillLinks, achievements, loaded }) {
  if (!loaded) return <p className="text-sm text-secondary">Loading…</p>

  const grouped = []
  const bySkill = new Map()
  for (const l of skillLinks) {
    if (!bySkill.has(l.skill_id)) {
      const entry = { skillId: l.skill_id, name: l.skills?.name, category: l.skills?.category, relationships: [] }
      bySkill.set(l.skill_id, entry)
      grouped.push(entry)
    }
    bySkill.get(l.skill_id).relationships.push(l.relationship)
  }

  return (
    <div className="space-y-6">
      <div>
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
          {item.type === 'education' ? 'Education' : 'Employment'}
        </span>
        <h3 className="font-display text-lg text-ink mt-0.5">{item.title}</h3>
        <p className="text-sm text-secondary">{item.organization}</p>
        <p className="font-mono text-xs text-secondary mt-1">
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
                {g.name} <span className="text-secondary">({g.category})</span> —{' '}
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

function SkillsDevelopedSubsection({ item, skills, skillLinks, librarySkills, onChange, onRefreshPickerData, user }) {
  const [skillId, setSkillId] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillCategory, setNewSkillCategory] = useState('')
  const [relationship, setRelationship] = useState('developed')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function handleNewSkillNameChange(value) {
    setNewSkillName(value)
    if (!newSkillCategory.trim()) {
      const match = librarySkills.find((s) => s.name.toLowerCase() === value.trim().toLowerCase())
      if (match?.category) setNewSkillCategory(match.category)
    }
  }

  const grouped = []
  const bySkill = new Map()
  for (const l of skillLinks) {
    if (!bySkill.has(l.skill_id)) {
      const entry = { skillId: l.skill_id, name: l.skills?.name, category: l.skills?.category, links: [] }
      bySkill.set(l.skill_id, entry)
      grouped.push(entry)
    }
    bySkill.get(l.skill_id).links.push(l)
  }

  async function handleAdd(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      let targetSkillId = skillId
      if (creatingNew) {
        if (!newSkillName.trim() || !newSkillCategory.trim()) {
          throw new Error('Name and category are required for a new skill.')
        }
        const libraryId = await findOrCreateLibrarySkill(newSkillName, newSkillCategory, user.id)
        const { data, error } = await supabase
          .from('skills')
          .insert({
            name: newSkillName.trim(),
            category: newSkillCategory.trim(),
            library_skill_id: libraryId,
            user_id: user.id,
          })
          .select()
          .single()
        if (error) throw error
        targetSkillId = data.id
        await onRefreshPickerData()
      }
      if (!targetSkillId) throw new Error('Choose or create a skill.')

      const { error } = await supabase.from('skill_experience_links').insert({
        user_id: user.id,
        skill_id: targetSkillId,
        experience_id: item.id,
        relationship,
      })
      if (error) {
        if (error.code === '23505') throw new Error('That relationship is already recorded for this skill.')
        throw error
      }
      setSkillId('')
      setCreatingNew(false)
      setNewSkillName('')
      setNewSkillCategory('')
      await onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeLink(linkId) {
    setError(null)
    const { error } = await supabase.from('skill_experience_links').delete().eq('id', linkId)
    if (error) setError(error.message)
    else await onChange()
  }

  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Skills developed</h4>

      {grouped.length === 0 ? (
        <p className="text-sm text-secondary mb-3">No skills linked yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {grouped.map((g) => (
            <li key={g.skillId} className="bg-paper border border-hairline rounded-md px-3 py-2">
              <p className="text-sm text-ink">
                {g.name} <span className="text-secondary">({g.category})</span>
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {g.links.map((l) => (
                  <span
                    key={l.id}
                    className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                  >
                    {SKILL_RELATIONSHIP_LABELS[l.relationship]}
                    <button type="button" onClick={() => removeLink(l.id)} className="text-red-700" aria-label="Remove">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="space-y-2 border-t border-hairline pt-3">
        {creatingNew ? (
          <div className="flex items-center gap-2">
            <input
              list="skill-library-options-developed"
              value={newSkillName}
              onChange={(e) => handleNewSkillNameChange(e.target.value)}
              placeholder="Search the skill library or type a new one…"
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <datalist id="skill-library-options-developed">
              {librarySkills.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <input
              value={newSkillCategory}
              onChange={(e) => setNewSkillCategory(e.target.value)}
              placeholder="Category"
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <button
              type="button"
              onClick={() => setCreatingNew(false)}
              className="shrink-0 text-xs text-secondary hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a skill…</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.category})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setCreatingNew(true)
                setSkillId('')
              }}
              className="shrink-0 text-xs text-moss font-medium"
            >
              + New skill
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          >
            {SKILL_RELATIONSHIPS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving}
            className="shrink-0 rounded-md bg-moss text-paper py-2 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            Add
          </button>
        </div>
      </form>
      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  )
}

function AchievementsSubsection({ item, skills, linkedCourses, achievements, librarySkills, onChange, onRefreshPickerData, user }) {
  const [skillId, setSkillId] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillCategory, setNewSkillCategory] = useState('')
  const [level, setLevel] = useState(3)
  const [achievedDate, setAchievedDate] = useState(item.end_date || item.start_date)
  const [comments, setComments] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [courseId, setCourseId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [levelSyncPrompt, setLevelSyncPrompt] = useState(null)

  const endBound = item.end_date || new Date().toISOString().slice(0, 10)
  const dateOutOfRange = achievedDate && (achievedDate < item.start_date || achievedDate > endBound)

  function handleNewSkillNameChange(value) {
    setNewSkillName(value)
    if (!newSkillCategory.trim()) {
      const match = librarySkills.find((s) => s.name.toLowerCase() === value.trim().toLowerCase())
      if (match?.category) setNewSkillCategory(match.category)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    setError(null)
    if (!achievedDate) {
      setError('An achievement date is required.')
      return
    }
    setSaving(true)
    try {
      let targetSkillId = skillId
      let targetSkillName = skills.find((s) => s.id === skillId)?.name
      if (creatingNew) {
        if (!newSkillName.trim() || !newSkillCategory.trim()) {
          throw new Error('Name and category are required for a new skill.')
        }
        const libraryId = await findOrCreateLibrarySkill(newSkillName, newSkillCategory, user.id)
        const { data, error } = await supabase
          .from('skills')
          .insert({
            name: newSkillName.trim(),
            category: newSkillCategory.trim(),
            library_skill_id: libraryId,
            user_id: user.id,
          })
          .select()
          .single()
        if (error) throw error
        targetSkillId = data.id
        targetSkillName = data.name
        await onRefreshPickerData()
      }
      if (!targetSkillId) throw new Error('Choose or create a skill.')

      const { data: assessment, error: assessmentError } = await supabase
        .from('skill_assessments')
        .insert({
          skill_id: targetSkillId,
          user_id: user.id,
          level,
          comments: comments.trim() || null,
          evidence_url: evidenceUrl.trim() || null,
          assessed_at: achievedDate,
          experience_id: item.id,
          course_id: courseId || null,
        })
        .select()
        .single()
      if (assessmentError) throw assessmentError

      if (evidenceFiles.length > 0) {
        const paths = await uploadEvidenceFiles(user.id, targetSkillId, assessment.id, evidenceFiles)
        const { error: updateError } = await supabase
          .from('skill_assessments')
          .update({ evidence_paths: paths })
          .eq('id', assessment.id)
        if (updateError) throw updateError
      }

      const { data: currentSkill } = await supabase
        .from('skills')
        .select('level')
        .eq('id', targetSkillId)
        .single()
      const { data: latest } = await supabase
        .from('skill_assessments')
        .select('id, assessed_at')
        .eq('skill_id', targetSkillId)
        .order('assessed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const isMostRecent = latest?.id === assessment.id
      const isHigher = currentSkill?.level == null || level > currentSkill.level
      if ((isMostRecent || isHigher) && level !== currentSkill?.level) {
        setLevelSyncPrompt({
          skillId: targetSkillId,
          skillName: targetSkillName,
          newLevel: level,
        })
      }

      setSkillId('')
      setCreatingNew(false)
      setNewSkillName('')
      setNewSkillCategory('')
      setComments('')
      setEvidenceUrl('')
      setEvidenceFiles([])
      setCourseId('')
      await onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function applyLevelSync() {
    await supabase.from('skills').update({ level: levelSyncPrompt.newLevel }).eq('id', levelSyncPrompt.skillId)
    await onRefreshPickerData()
    setLevelSyncPrompt(null)
  }

  async function removeAchievement(id) {
    setError(null)
    const { error } = await supabase.from('skill_assessments').delete().eq('id', id)
    if (error) setError(error.message)
    else await onChange()
  }

  return (
    <div>
      <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">Skill achievements</h4>

      {levelSyncPrompt && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-gold bg-gold/10 px-3 py-2 mb-3">
          <p className="text-sm text-ink">
            This is your highest or most recent recorded level for {levelSyncPrompt.skillName}. Update the
            current profile level to {LEVEL_LABELS[levelSyncPrompt.newLevel]}?
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={applyLevelSync} className="text-xs text-moss font-medium">
              Update
            </button>
            <button
              type="button"
              onClick={() => setLevelSyncPrompt(null)}
              className="text-xs text-secondary"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {achievements.length === 0 ? (
        <p className="text-sm text-secondary mb-3">No achievements recorded yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {achievements.map((a) => (
            <li key={a.id} className="bg-paper border border-hairline rounded-md px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {a.skills?.name} <span className="text-secondary">· {LEVEL_LABELS[a.level]}</span>
                  </p>
                  <p className="font-mono text-xs text-secondary">
                    {new Date(a.assessed_at).toLocaleDateString()}
                    {a.courses?.name ? ` · via ${a.courses.name}` : ''}
                  </p>
                  {a.comments && <p className="text-sm text-ink mt-1">{a.comments}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => removeAchievement(a.id)}
                  className="shrink-0 text-xs text-red-700 font-medium"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="space-y-3 border-t border-hairline pt-3">
        {creatingNew ? (
          <div className="flex items-center gap-2">
            <input
              list="skill-library-options-achievement"
              value={newSkillName}
              onChange={(e) => handleNewSkillNameChange(e.target.value)}
              placeholder="Search the skill library or type a new one…"
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <datalist id="skill-library-options-achievement">
              {librarySkills.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <input
              value={newSkillCategory}
              onChange={(e) => setNewSkillCategory(e.target.value)}
              placeholder="Category"
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <button
              type="button"
              onClick={() => setCreatingNew(false)}
              className="shrink-0 text-xs text-secondary hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a skill…</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.category})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setCreatingNew(true)
                setSkillId('')
              }}
              className="shrink-0 text-xs text-moss font-medium"
            >
              + New skill
            </button>
          </div>
        )}

        <div>
          <span className="block text-sm text-secondary mb-2">Level reached</span>
          <div className="flex items-center justify-between">
            {LEVELS.map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setLevel(l)}
                className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                  level === l ? 'bg-moss/10' : ''
                }`}
              >
                <GrowthRing level={l} size={36} />
                <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-secondary mb-1" htmlFor="achievedDate">
            Achieved on
          </label>
          <input
            id="achievedDate"
            type="date"
            value={achievedDate}
            onChange={(e) => setAchievedDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          {dateOutOfRange && (
            <p className="text-xs text-gold mt-1">
              This date falls outside this {item.type === 'education' ? 'study period' : 'role'} (
              {formatMonthYear(item.start_date)} – {item.end_date ? formatMonthYear(item.end_date) : 'present'}
              ). You can still save it if that's intentional.
            </p>
          )}
        </div>

        {linkedCourses.length > 0 && (
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="achievementCourse">
              Part of a linked course (optional)
            </label>
            <select
              id="achievementCourse"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">— None —</option>
              {linkedCourses.map((l) => (
                <option key={l.course_id} value={l.course_id}>
                  {l.courses?.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <textarea
          rows={3}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="What happened — assessment passed, accreditation earned, project delivered…"
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />

        <EvidenceFields
          evidenceUrl={evidenceUrl}
          onEvidenceUrlChange={setEvidenceUrl}
          files={evidenceFiles}
          onFilesChange={setEvidenceFiles}
        />

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Add achievement'}
        </button>
      </form>
    </div>
  )
}
