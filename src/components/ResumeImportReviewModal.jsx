import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadAvatar, base64ToBlob } from '../lib/avatar'
import { findOrCreateLibrarySkill } from '../lib/skillLibrary'
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

export default function ResumeImportReviewModal({
  extracted,
  hasAvatar,
  onAvatarSet,
  onProfileFieldsFilled,
  onClose,
  onImported,
}) {
  const { user } = useAuth()
  const skills = useSelection(extracted.skills ?? [])
  const courses = useSelection(extracted.courses ?? [])
  const experience = useSelection(extracted.experience ?? [])

  const profileFields = extracted.profile ?? {}
  const hasProfileFields = Object.values(profileFields).some(Boolean)
  const [applyProfile, setApplyProfile] = useState(true)

  const hasPhoto = Boolean(extracted.photoBase64) && !hasAvatar
  const [applyPhoto, setApplyPhoto] = useState(true)

  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)

  const totalSelected = skills.selected.size + courses.selected.size + experience.selected.size

  async function handleImport() {
    setError(null)
    setImporting(true)

    const selectedSkills = skills.values.filter((_, i) => skills.selected.has(i))
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
      if (selectedSkills.length) {
        const libraryIds = await Promise.all(
          selectedSkills.map((s) => findOrCreateLibrarySkill(s.name, s.category, user.id))
        )
        const skillRows = selectedSkills.map((s, i) => ({
          name: s.name,
          category: s.category,
          level: s.level,
          notes: s.notes,
          is_current_role: Boolean(s.current_role),
          source: 'cv_import',
          library_skill_id: libraryIds[i],
          user_id: user.id,
        }))
        const { data: insertedSkills, error } = await supabase
          .from('skills')
          .insert(skillRows)
          .select()
        if (error) throw error

        const genesisAssessments = insertedSkills.map((s) => ({
          skill_id: s.id,
          user_id: user.id,
          level: s.level,
          comments: s.notes,
        }))
        const { error: assessmentError } = await supabase
          .from('skill_assessments')
          .insert(genesisAssessments)
        if (assessmentError) throw assessmentError
      }
      if (courseRows.length) {
        const { error } = await supabase.from('courses').insert(courseRows)
        if (error) throw error
      }
      if (experienceRows.length) {
        const { error } = await supabase.from('experience').insert(experienceRows)
        if (error) throw error
      }
      if (applyProfile && hasProfileFields) {
        onProfileFieldsFilled?.(profileFields)
      }
      if (applyPhoto && hasPhoto) {
        const blob = base64ToBlob(extracted.photoBase64, extracted.photoContentType || 'image/jpeg')
        const url = await uploadAvatar(user.id, blob, extracted.photoContentType?.split('/')[1])
        onAvatarSet?.(url)
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

        {(hasProfileFields || hasPhoto) && (
          <div className="mb-6 space-y-3">
            {hasPhoto && (
              <label className="flex items-center gap-3 border border-hairline rounded-md p-3 bg-paper">
                <input
                  type="checkbox"
                  checked={applyPhoto}
                  onChange={(e) => setApplyPhoto(e.target.checked)}
                  className="rounded border-hairline"
                />
                <img
                  src={`data:${extracted.photoContentType || 'image/jpeg'};base64,${extracted.photoBase64}`}
                  alt="Found in document"
                  className="w-12 h-12 rounded-full object-cover border border-hairline"
                />
                <span className="text-sm text-ink">Set as your profile photo</span>
              </label>
            )}
            {extracted.photoBase64 && hasAvatar && (
              <p className="text-xs text-secondary">
                Found a photo in this document, but you already have a profile photo — leaving it
                as is.
              </p>
            )}

            {hasProfileFields && (
              <label className="flex items-start gap-3 border border-hairline rounded-md p-3 bg-paper">
                <input
                  type="checkbox"
                  checked={applyProfile}
                  onChange={(e) => setApplyProfile(e.target.checked)}
                  className="mt-0.5 rounded border-hairline"
                />
                <span className="text-sm text-ink">
                  Fill in blank profile fields:{' '}
                  <span className="text-secondary">
                    {[profileFields.full_name, profileFields.country, profileFields.location, profileFields.language]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </label>
            )}
          </div>
        )}

        <ReviewSection
          title="Skills"
          selection={skills}
          renderItem={(item, i, sel) => (
            <SkillRow
              key={i}
              item={item}
              checked={sel.selected.has(i)}
              onToggle={() => sel.toggle(i)}
              onChange={(v) => sel.updateField(i, 'name', v)}
            />
          )}
        />

        <ReviewSection
          title="Training & courses"
          selection={courses}
          renderItem={(item, i, sel) => (
            <CourseRow
              key={i}
              item={item}
              checked={sel.selected.has(i)}
              onToggle={() => sel.toggle(i)}
              onChange={(v) => sel.updateField(i, 'name', v)}
            />
          )}
        />

        <ReviewSection
          title="Experience"
          selection={experience}
          renderItem={(item, i, sel) => (
            <ExperienceRow
              key={i}
              item={item}
              checked={sel.selected.has(i)}
              onToggle={() => sel.toggle(i)}
              onChange={(v) => sel.updateField(i, 'title', v)}
            />
          )}
        />

        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}

        <div className="flex items-center gap-2 pt-4 mt-4 border-t border-hairline">
          <button
            onClick={handleImport}
            disabled={importing || (totalSelected === 0 && !(applyProfile && hasProfileFields) && !(applyPhoto && hasPhoto))}
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
        {item.current_role ? ' · Current role' : ''}
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
