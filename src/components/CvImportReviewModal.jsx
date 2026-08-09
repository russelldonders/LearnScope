import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatMonthYear } from '../lib/dates'

function useSelection(items) {
  const [selected, setSelected] = useState(() => new Set(items.map((_, i) => i)))
  const [values, setValues] = useState(items)

  function toggle(i) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function updateField(i, field, value) {
    setValues((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)))
  }

  return { selected, values, toggle, updateField }
}

export default function CvImportReviewModal({ extracted, onClose, onImported }) {
  const { user } = useAuth()
  const skills = useSelection(extracted.skills ?? [])
  const courses = useSelection(extracted.courses ?? [])
  const experience = useSelection(extracted.experience ?? [])
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)

  const totalSelected = skills.selected.size + courses.selected.size + experience.selected.size

  async function handleImport() {
    setError(null)
    setImporting(true)

    const skillRows = skills.values
      .filter((_, i) => skills.selected.has(i))
      .map((s) => ({
        name: s.name,
        category: s.category,
        level: s.level,
        notes: s.notes,
        user_id: user.id,
      }))
    const courseRows = courses.values
      .filter((_, i) => courses.selected.has(i))
      .map((c) => ({
        name: c.name,
        provider: c.provider,
        completed_date: c.completed_date,
        notes: c.notes,
        user_id: user.id,
      }))
    const experienceRows = experience.values
      .filter((_, i) => experience.selected.has(i))
      .map((e) => ({
        type: e.type,
        title: e.title,
        organization: e.organization,
        start_date: e.start_date,
        end_date: e.end_date,
        description: e.description,
        user_id: user.id,
      }))

    try {
      if (skillRows.length) {
        const { error } = await supabase.from('skills').insert(skillRows)
        if (error) throw error
      }
      if (courseRows.length) {
        const { error } = await supabase.from('courses').insert(courseRows)
        if (error) throw error
      }
      if (experienceRows.length) {
        const { error } = await supabase.from('experience').insert(experienceRows)
        if (error) throw error
      }
      onImported()
    } catch (err) {
      setError(err.message)
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl text-ink mb-1">Review before import</h2>
        <p className="text-sm text-secondary mb-6">
          Uncheck anything you don't want, tweak the name/title if needed, then import.
        </p>

        <ReviewSection title="Skills" selection={skills} renderItem={(item, i, sel) => (
          <SkillRow key={i} item={item} checked={sel.selected.has(i)} onToggle={() => sel.toggle(i)}
            onChange={(v) => sel.updateField(i, 'name', v)} />
        )} />

        <ReviewSection title="Training & courses" selection={courses} renderItem={(item, i, sel) => (
          <CourseRow key={i} item={item} checked={sel.selected.has(i)} onToggle={() => sel.toggle(i)}
            onChange={(v) => sel.updateField(i, 'name', v)} />
        )} />

        <ReviewSection title="Experience" selection={experience} renderItem={(item, i, sel) => (
          <ExperienceRow key={i} item={item} checked={sel.selected.has(i)} onToggle={() => sel.toggle(i)}
            onChange={(v) => sel.updateField(i, 'title', v)} />
        )} />

        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}

        <div className="flex items-center gap-2 pt-4 mt-4 border-t border-hairline">
          <button
            onClick={handleImport}
            disabled={importing || totalSelected === 0}
            className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {importing ? 'Importing…' : `Import ${totalSelected} item${totalSelected === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function ReviewSection({ title, selection, renderItem }) {
  if (selection.values.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">
        {title} ({selection.values.length})
      </h3>
      <div className="space-y-2">
        {selection.values.map((item, i) => renderItem(item, i, selection))}
      </div>
    </div>
  )
}

function Row({ checked, onToggle, children }) {
  return (
    <label className="flex items-start gap-3 border border-hairline rounded-md p-2 bg-paper">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-2 rounded border-hairline"
      />
      <div className="flex-1 min-w-0">{children}</div>
    </label>
  )
}

function SkillRow({ item, checked, onToggle, onChange }) {
  return (
    <Row checked={checked} onToggle={onToggle}>
      <input
        value={item.name}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent font-display text-ink border-b border-transparent focus:border-hairline focus:outline-none"
      />
      <p className="text-xs text-secondary mt-0.5">
        {item.category} · Level {item.level}
      </p>
    </Row>
  )
}

function CourseRow({ item, checked, onToggle, onChange }) {
  return (
    <Row checked={checked} onToggle={onToggle}>
      <input
        value={item.name}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent font-display text-ink border-b border-transparent focus:border-hairline focus:outline-none"
      />
      <p className="text-xs text-secondary mt-0.5">
        {item.provider}
        {item.completed_date ? ` · ${formatMonthYear(item.completed_date)}` : ''}
      </p>
    </Row>
  )
}

function ExperienceRow({ item, checked, onToggle, onChange }) {
  return (
    <Row checked={checked} onToggle={onToggle}>
      <input
        value={item.title}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent font-display text-ink border-b border-transparent focus:border-hairline focus:outline-none"
      />
      <p className="text-xs text-secondary mt-0.5">
        {item.organization} · {item.type === 'education' ? 'Education' : 'Employment'} ·{' '}
        {formatMonthYear(item.start_date)} –{' '}
        {item.end_date ? formatMonthYear(item.end_date) : 'Present'}
      </p>
    </Row>
  )
}
