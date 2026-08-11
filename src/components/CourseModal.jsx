import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatMonthYear } from '../lib/dates'
import GrowthRing from './GrowthRing'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Details' },
]

export default function CourseModal({ course, skills, linkedAssessment, onSave, onDelete, onClose }) {
  const isEditing = Boolean(course?.id)
  const [tab, setTab] = useState('overview')
  const [linkedExperiences, setLinkedExperiences] = useState([])
  const [name, setName] = useState(course?.name ?? '')
  const [provider, setProvider] = useState(course?.provider ?? '')
  const [completedDate, setCompletedDate] = useState(course?.completed_date ?? '')
  const [notes, setNotes] = useState(course?.notes ?? '')
  const [skillId, setSkillId] = useState(linkedAssessment?.skill_id ?? '')
  const [skillLevel, setSkillLevel] = useState(linkedAssessment?.level ?? 3)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isEditing) return
    supabase
      .from('course_experience_links')
      .select('id, experience(id, title, organization, type)')
      .eq('course_id', course.id)
      .then(({ data }) => setLinkedExperiences(data ?? []))
  }, [])

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
        notes: notes.trim() || null,
        skillId: skillId || null,
        level: skillId ? skillLevel : null,
        linkedAssessmentId: linkedAssessment?.id ?? null,
        previousSkillId: linkedAssessment?.skill_id ?? null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${course.name}"? This can't be undone.`)) return
    setSaving(true)
    try {
      await onDelete(course.id)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl text-ink mb-4">
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

        {isEditing && tab === 'overview' && (
          <div className="space-y-6">
            <div>
              {course.provider && <p className="text-sm text-secondary">{course.provider}</p>}
              {course.completed_date && (
                <p className="font-mono text-xs text-secondary mt-1">
                  Completed {formatMonthYear(course.completed_date)}
                </p>
              )}
              {course.notes && (
                <p className="text-sm text-ink mt-2 whitespace-pre-line">{course.notes}</p>
              )}
            </div>

            {linkedAssessment && (
              <div>
                <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">
                  Skill earned
                </h4>
                <div className="flex items-center gap-3">
                  <GrowthRing level={linkedAssessment.level} size={36} />
                  <p className="text-sm text-ink">
                    {linkedAssessment.skills?.name}
                    {linkedAssessment.skills?.category ? ` (${linkedAssessment.skills.category})` : ''} ·{' '}
                    {LEVEL_LABELS[linkedAssessment.level]}
                  </p>
                </div>
              </div>
            )}

            {linkedExperiences.length > 0 && (
              <div>
                <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">
                  Part of
                </h4>
                <ul className="space-y-1">
                  {linkedExperiences.map((l) => (
                    <li key={l.id} className="text-sm text-ink">
                      {l.experience?.title}{' '}
                      <span className="text-secondary">· {l.experience?.organization}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

          <div className="border-t border-hairline pt-4 space-y-3">
            <h4 className="font-mono text-xs uppercase tracking-wide text-secondary">
              Skill earned (optional)
            </h4>
            {skills.length === 0 ? (
              <p className="text-xs text-secondary">
                You don't have any skills yet — add one first to link it here.
              </p>
            ) : (
              <>
                <select
                  value={skillId}
                  onChange={(e) => setSkillId(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
                >
                  <option value="">— None —</option>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.category})
                    </option>
                  ))}
                </select>

                {skillId && (
                  <div>
                    <span className="block text-sm text-secondary mb-2">Level earned</span>
                    <div className="flex items-center justify-between">
                      {LEVELS.map((l) => (
                        <button
                          type="button"
                          key={l}
                          onClick={() => setSkillLevel(l)}
                          className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                            skillLevel === l ? 'bg-moss/10' : ''
                          }`}
                        >
                          <GrowthRing level={l} size={36} />
                          <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
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
      </div>
    </div>
  )
}
