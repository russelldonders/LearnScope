import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { findOrCreateLibrarySkill } from '../lib/skillLibrary'
import { formatMonthYear } from '../lib/dates'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'
import { SKILL_RELATIONSHIPS, SKILL_RELATIONSHIP_LABELS } from '../lib/skillRelationships'
import { COURSE_TYPES } from '../lib/courseTypes'
import { isDuplicateSkillNameError, duplicateSkillMessage } from '../lib/skillDuplicates'
import GrowthRing from './GrowthRing'
import AccessibleDialog from './AccessibleDialog'
import EvidenceFields from './EvidenceFields'
import ConfirmDialog from './ConfirmDialog'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'skills', label: 'Skills' },
  { id: 'details', label: 'Details' },
]

export default function CourseModal({
  course,
  skills,
  librarySkills,
  initialTab = 'overview',
  onRefreshPickerData,
  onSave,
  onDelete,
  onClose,
}) {
  const { user } = useAuth()
  const isEditing = Boolean(course?.id)
  const [tab, setTab] = useState(initialTab)
  const [name, setName] = useState(course?.name ?? '')
  const [provider, setProvider] = useState(course?.provider ?? '')
  const [completedDate, setCompletedDate] = useState(course?.completed_date ?? '')
  const [duration, setDuration] = useState(course?.duration ?? '')
  const [courseType, setCourseType] = useState(course?.course_type ?? '')
  const [notes, setNotes] = useState(course?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [linkedExperiences, setLinkedExperiences] = useState([])
  const [skillLinks, setSkillLinks] = useState([])
  const [achievements, setAchievements] = useState([])
  const [learningLoaded, setLearningLoaded] = useState(false)

  useEffect(() => {
    if (!isEditing) return
    loadLearning()
  }, [])

  async function loadLearning() {
    const [{ data: el }, { data: sl }, { data: ach }] = await Promise.all([
      supabase
        .from('course_experience_links')
        .select('id, experience_id, experience(id, title, organization, type)')
        .eq('course_id', course.id),
      supabase
        .from('skill_course_links')
        .select('id, skill_id, relationship, skills(id, name)')
        .eq('course_id', course.id)
        .order('created_at'),
      supabase
        .from('skill_assessments')
        .select('*, skills(name)')
        .eq('course_id', course.id)
        .order('assessed_at', { ascending: false }),
    ])
    setLinkedExperiences(el ?? [])
    setSkillLinks(sl ?? [])
    setAchievements(ach ?? [])
    setLearningLoaded(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({
        id: course?.id,
        name: name.trim(),
        provider: provider.trim() || null,
        completed_date: completedDate || null,
        duration: duration.trim() || null,
        course_type: courseType.trim() || null,
        notes: notes.trim() || null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    try {
      await onDelete(course.id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    } finally {
      setConfirmingDelete(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="course-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="course-dialog-title" className="font-display text-2xl text-ink mb-4">
          {isEditing ? course.name : 'Add a course'}
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
              <label className="block text-sm text-secondary mb-1" htmlFor="courseName">
                Name
              </label>
              <input
                id="courseName"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="provider">
                Provider
              </label>
              <input
                id="provider"
                placeholder="Coursera, Toastmasters, in-house…"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="courseType">
                  Type
                </label>
                <input
                  id="courseType"
                  list="course-type-options"
                  placeholder="Online, Degree, Seminar…"
                  value={courseType}
                  onChange={(e) => setCourseType(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                <datalist id="course-type-options">
                  {COURSE_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="duration">
                  Duration
                </label>
                <input
                  id="duration"
                  placeholder="6 weeks, 40 hours…"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="completedDate">
                Completed on
              </label>
              <input
                id="completedDate"
                type="date"
                value={completedDate}
                onChange={(e) => setCompletedDate(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="courseNotes">
                Notes
              </label>
              <textarea
                id="courseNotes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What it covered, certificate link…"
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
                  onClick={() => setConfirmingDelete(true)}
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
            course={course}
            linkedExperiences={linkedExperiences}
            skillLinks={skillLinks}
            achievements={achievements}
            loaded={learningLoaded}
          />
        )}

        {isEditing && tab === 'skills' && (
          <div className="space-y-8">
            <SkillsDevelopedSubsection
              course={course}
              skills={skills}
              skillLinks={skillLinks}
              librarySkills={librarySkills}
              onChange={loadLearning}
              onRefreshPickerData={onRefreshPickerData}
              user={user}
            />

            <AchievementsSubsection
              course={course}
              skills={skills}
              achievements={achievements}
              librarySkills={librarySkills}
              onChange={loadLearning}
              onRefreshPickerData={onRefreshPickerData}
              user={user}
            />
          </div>
        )}

      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete "${course.name}"? This can't be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmingDelete(false)}
          confirming={saving}
        />
      )}
    </AccessibleDialog>
  )
}

function OverviewTab({ course, linkedExperiences, skillLinks, achievements, loaded }) {
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
        <h3 className="font-display text-lg text-ink">{course.name}</h3>
        {course.provider && <p className="text-sm text-secondary">{course.provider}</p>}
        <p className="font-mono text-xs text-secondary mt-1">
          {[course.course_type, course.duration].filter(Boolean).join(' · ')}
        </p>
        {course.completed_date && (
          <p className="font-mono text-xs text-secondary mt-1">
            Completed {formatMonthYear(course.completed_date)}
          </p>
        )}
        {course.notes && <p className="text-sm text-ink mt-2 whitespace-pre-line">{course.notes}</p>}
      </div>

      {linkedExperiences.length > 0 && (
        <div>
          <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">Part of</h4>
          <ul className="space-y-1">
            {linkedExperiences.map((l) => (
              <li key={l.id} className="text-sm text-ink">
                {l.experience?.title} <span className="text-secondary">· {l.experience?.organization}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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

function SkillsDevelopedSubsection({ course, skills, skillLinks, librarySkills, onChange, onRefreshPickerData, user }) {
  const [skillId, setSkillId] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [relationship, setRelationship] = useState('developed')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const grouped = []
  const bySkill = new Map()
  for (const l of skillLinks) {
    if (!bySkill.has(l.skill_id)) {
      const entry = { skillId: l.skill_id, name: l.skills?.name, links: [] }
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
        if (!newSkillName.trim()) {
          throw new Error('A name is required for a new skill.')
        }
        const libraryId = await findOrCreateLibrarySkill(newSkillName, null, user.id)
        const { data, error } = await supabase
          .from('skills')
          .insert({
            name: newSkillName.trim(),
            library_skill_id: libraryId,
            user_id: user.id,
          })
          .select()
          .single()
        if (error) {
          if (isDuplicateSkillNameError(error)) throw new Error(duplicateSkillMessage(newSkillName))
          throw error
        }
        targetSkillId = data.id
        await onRefreshPickerData()
      }
      if (!targetSkillId) throw new Error('Choose or create a skill.')

      const { error } = await supabase.from('skill_course_links').insert({
        user_id: user.id,
        skill_id: targetSkillId,
        course_id: course.id,
        relationship,
      })
      if (error) {
        if (error.code === '23505') throw new Error('That relationship is already recorded for this skill.')
        throw error
      }
      setSkillId('')
      setCreatingNew(false)
      setNewSkillName('')
      await onChange()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeLink(linkId) {
    setError(null)
    const { error } = await supabase.from('skill_course_links').delete().eq('id', linkId)
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
              <p className="text-sm text-ink">{g.name}</p>
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
              list="skill-library-options-course-developed"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              placeholder="Search the skill library or type a new one…"
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <datalist id="skill-library-options-course-developed">
              {librarySkills.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
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
                  {s.name}
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

function AchievementsSubsection({ course, skills, achievements, librarySkills, onChange, onRefreshPickerData, user }) {
  const [skillId, setSkillId] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [newSkillName, setNewSkillName] = useState('')
  const [level, setLevel] = useState(3)
  const [achievedDate, setAchievedDate] = useState(course.completed_date || new Date().toISOString().slice(0, 10))
  const [comments, setComments] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [levelSyncPrompt, setLevelSyncPrompt] = useState(null)

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
        if (!newSkillName.trim()) {
          throw new Error('A name is required for a new skill.')
        }
        const libraryId = await findOrCreateLibrarySkill(newSkillName, null, user.id)
        const { data, error } = await supabase
          .from('skills')
          .insert({
            name: newSkillName.trim(),
            library_skill_id: libraryId,
            user_id: user.id,
          })
          .select()
          .single()
        if (error) {
          if (isDuplicateSkillNameError(error)) throw new Error(duplicateSkillMessage(newSkillName))
          throw error
        }
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
          source: 'course',
          course_id: course.id,
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
      setComments('')
      setEvidenceUrl('')
      setEvidenceFiles([])
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
    const target = achievements.find((a) => a.id === id)
    const { error } = await supabase.from('skill_assessments').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    if (target) {
      const { data: currentSkill } = await supabase
        .from('skills')
        .select('level')
        .eq('id', target.skill_id)
        .single()
      if (currentSkill?.level === target.level) {
        const { data: remaining } = await supabase
          .from('skill_assessments')
          .select('level, assessed_at')
          .eq('skill_id', target.skill_id)
          .order('assessed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (remaining && remaining.level !== currentSkill.level) {
          setLevelSyncPrompt({
            skillId: target.skill_id,
            skillName: target.skills?.name,
            newLevel: remaining.level,
          })
        }
      }
    }
    await onChange()
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
              list="skill-library-options-course-achievement"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              placeholder="Search the skill library or type a new one…"
              className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <datalist id="skill-library-options-course-achievement">
              {librarySkills.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
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
                  {s.name}
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
          <label className="block text-sm text-secondary mb-1" htmlFor="courseAchievedDate">
            Achieved on
          </label>
          <input
            id="courseAchievedDate"
            type="date"
            value={achievedDate}
            onChange={(e) => setAchievedDate(e.target.value)}
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>

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

