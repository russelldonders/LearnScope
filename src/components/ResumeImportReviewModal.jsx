import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadAvatar, base64ToBlob } from '../lib/avatar'
import { findOrCreateLibrarySkill, listLibrarySkills } from '../lib/skillLibrary'
import { addTagToSkill } from '../lib/skillTags'
import { formatMonthYear } from '../lib/dates'
import {
  enableCurrentRole,
  applyCurrentRoleSelection,
  syncSkillIsCurrentRole,
  listCurrentRoleExperiences,
} from '../lib/currentRole'
import CurrentRoleSelectModal from './CurrentRoleSelectModal'

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

const courseKey = (c) => `${(c.name ?? '').toLowerCase().trim()}|${(c.provider ?? '').toLowerCase().trim()}`
const experienceKey = (e) =>
  `${(e.title ?? '').toLowerCase().trim()}|${(e.organization ?? '').toLowerCase().trim()}|${e.start_date ?? ''}`

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
  const [existingSkillNames, setExistingSkillNames] = useState(null)
  const [existingCourseKeys, setExistingCourseKeys] = useState(null)
  const [existingExperienceKeys, setExistingExperienceKeys] = useState(null)
  const [libraryMatches, setLibraryMatches] = useState(null)

  // Skills already in the profile can't be imported again (name must be
  // unique per learner) -- fetch them once so duplicate rows can be shown
  // as such and excluded, rather than failing the whole import.
  useEffect(() => {
    supabase
      .from('skills')
      .select('name')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const names = new Set((data ?? []).map((s) => s.name.toLowerCase().trim()))
        setExistingSkillNames(names)
        skills.values.forEach((s, i) => {
          if (names.has(s.name.toLowerCase().trim()) && skills.selected.has(i)) {
            skills.toggle(i)
          }
        })
      })
  }, [])

  // Same idea as existingSkillNames, but for courses/experience -- re-importing
  // the same document (or two overlapping ones) shouldn't create duplicate rows.
  useEffect(() => {
    supabase
      .from('courses')
      .select('name, provider')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const keys = new Set((data ?? []).map(courseKey))
        setExistingCourseKeys(keys)
        courses.values.forEach((c, i) => {
          if (keys.has(courseKey(c)) && courses.selected.has(i)) courses.toggle(i)
        })
      })
  }, [])

  useEffect(() => {
    supabase
      .from('experience')
      .select('title, organization, start_date')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const keys = new Set((data ?? []).map(experienceKey))
        setExistingExperienceKeys(keys)
        experience.values.forEach((e, i) => {
          if (keys.has(experienceKey(e)) && experience.selected.has(i)) experience.toggle(i)
        })
      })
  }, [])

  // Lets each skill row show whether it'll link to an existing shared-library
  // skill (name/tags lock afterward) or create a new one (learner can choose
  // to keep it private) -- rather than that happening silently during import.
  useEffect(() => {
    listLibrarySkills().then((rows) => {
      setLibraryMatches(new Map(rows.map((r) => [r.name.toLowerCase().trim(), r])))
    })
  }, [])

  const profileFields = extracted.profile ?? {}
  const hasProfileFields = Object.values(profileFields).some(Boolean)
  const [applyProfile, setApplyProfile] = useState(true)

  const hasPhoto = Boolean(extracted.photoBase64) && !hasAvatar
  const [applyPhoto, setApplyPhoto] = useState(true)

  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)
  const [currentRolePrompt, setCurrentRolePrompt] = useState(null)

  const totalSelected = skills.selected.size + courses.selected.size + experience.selected.size

  async function handleImport() {
    setError(null)
    setImporting(true)

    const selectedSkills = skills.values.filter(
      (s, i) => skills.selected.has(i) && !existingSkillNames?.has(s.name.toLowerCase().trim())
    )
    const courseRows = courses.values
      .filter((c, i) => courses.selected.has(i) && !existingCourseKeys?.has(courseKey(c)))
      .map((c) => ({
        name: c.name,
        provider: c.provider,
        completed_date: c.completed_date,
        notes: c.notes,
        user_id: user.id,
      }))
    const experienceRows = experience.values
      .filter((e, i) => experience.selected.has(i) && !existingExperienceKeys?.has(experienceKey(e)))
      .map((e) => ({
        type: e.type,
        title: e.title,
        organization: e.organization,
        start_date: e.start_date,
        end_date: e.end_date,
        description: e.description,
        user_id: user.id,
      }))

    let currentRoleSkillIds = []

    try {
      if (selectedSkills.length) {
        const libraryIds = await Promise.all(
          selectedSkills.map((s) =>
            findOrCreateLibrarySkill(s.name, null, user.id, Boolean(s.keepPrivate))
          )
        )
        const skillRows = selectedSkills.map((s, i) => ({
          name: s.name,
          level: s.level,
          // s.notes goes on the genesis skill_assessments row below as its
          // comments, same field a self-assessment uses -- not here, since
          // skills.notes isn't surfaced or editable anywhere on the skill
          // itself (only the grid card used to render it).
          // Starts false regardless of the CV's "current role" guess -- set
          // true below only once actually linked to a current-role
          // experience, mirroring FindSkillModal/SkillDetail.
          is_current_role: false,
          source: 'cv_import',
          library_skill_id: libraryIds[i],
          user_id: user.id,
          // Blank unless the learner filled in "Since" -- otherwise this
          // stays on the column default (import time), same as before.
          ...(s.since ? { date_added: s.since } : {}),
        }))
        const { data: insertedSkills, error } = await supabase
          .from('skills')
          .insert(skillRows)
          .select()
        if (error) throw error

        const genesisAssessments = insertedSkills.map((s, i) => ({
          skill_id: s.id,
          user_id: user.id,
          level: s.level,
          comments: selectedSkills[i].notes,
        }))
        const { error: assessmentError } = await supabase
          .from('skill_assessments')
          .insert(genesisAssessments)
        if (assessmentError) throw assessmentError

        for (let i = 0; i < insertedSkills.length; i++) {
          for (const tagName of selectedSkills[i].tags ?? []) {
            if (tagName?.trim()) await addTagToSkill(user.id, insertedSkills[i].id, tagName)
          }
        }

        currentRoleSkillIds = insertedSkills
          .filter((_, i) => Boolean(selectedSkills[i].current_role))
          .map((s) => s.id)
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

      if (currentRoleSkillIds.length > 0) {
        // A CV can flag several skills as "current role" at once -- rather
        // than prompting once per skill when the learner has multiple
        // ongoing jobs, resolve the picker once for the whole batch and
        // apply the same choice to every flagged skill.
        const roles = await listCurrentRoleExperiences(user.id)
        if (roles.length >= 2) {
          setCurrentRolePrompt({ skillIds: currentRoleSkillIds, roles })
          setImporting(false)
          return
        }
        for (const skillId of currentRoleSkillIds) {
          await enableCurrentRole(user.id, skillId)
        }
      }

      onImported()
    } catch (err) {
      setError(err.message)
      setImporting(false)
    }
  }

  async function handleCurrentRoleConfirm(experienceIds) {
    for (const skillId of currentRolePrompt.skillIds) {
      await applyCurrentRoleSelection(user.id, skillId, experienceIds)
    }
    setCurrentRolePrompt(null)
    onImported()
  }

  async function handleCurrentRoleCancel() {
    for (const skillId of currentRolePrompt.skillIds) {
      await syncSkillIsCurrentRole(user.id, skillId)
    }
    setCurrentRolePrompt(null)
    onImported()
  }

  if (currentRolePrompt) {
    return (
      <CurrentRoleSelectModal
        roles={currentRolePrompt.roles}
        onConfirm={handleCurrentRoleConfirm}
        onCancel={handleCurrentRoleCancel}
      />
    )
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
                    {[
                      [profileFields.first_name, profileFields.last_name].filter(Boolean).join(' '),
                      profileFields.country,
                      profileFields.location,
                      profileFields.language,
                    ]
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
              alreadyExists={Boolean(existingSkillNames?.has(item.name.toLowerCase().trim()))}
              libraryMatch={libraryMatches?.get(item.name.toLowerCase().trim())}
              onToggle={() => sel.toggle(i)}
              onChange={(v) => sel.updateField(i, 'name', v)}
              onSinceChange={(v) => sel.updateField(i, 'since', v)}
              onKeepPrivateChange={(v) => sel.updateField(i, 'keepPrivate', v)}
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
              alreadyExists={Boolean(existingCourseKeys?.has(courseKey(item)))}
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
              alreadyExists={Boolean(existingExperienceKeys?.has(experienceKey(item)))}
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

function Row({ checked, onToggle, disabled, children }) {
  return (
    <label className={`flex items-start gap-3 border border-hairline rounded-md p-2 bg-paper ${disabled ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="mt-2 rounded border-hairline"
      />
      <div className="flex-1 min-w-0">{children}</div>
    </label>
  )
}

function SkillRow({ item, checked, alreadyExists, libraryMatch, onToggle, onChange, onSinceChange, onKeepPrivateChange }) {
  return (
    <Row checked={checked && !alreadyExists} onToggle={onToggle} disabled={alreadyExists}>
      <input
        value={item.name}
        onChange={(e) => onChange(e.target.value)}
        disabled={alreadyExists}
        className="w-full bg-transparent font-display text-ink border-b border-transparent focus:border-hairline focus:outline-none disabled:opacity-60"
      />
      <p className="text-xs text-secondary mt-0.5">
        {item.tags?.length > 0 && item.tags.join(', ')} · Level {item.level}
        {item.current_role ? ' · Current role' : ''}
        {alreadyExists ? ' · Already in your profile' : ''}
      </p>
      {!alreadyExists && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            Since
            <input
              type="date"
              value={item.since ?? ''}
              onChange={(e) => onSinceChange(e.target.value)}
              className="rounded border border-hairline bg-paper px-1.5 py-0.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-moss"
            />
          </label>
          {libraryMatch ? (
            <span className="text-xs text-secondary">
              Matches the library skill "{libraryMatch.name}" — name and tags will stay fixed
              after import.
            </span>
          ) : (
            <label className="flex items-center gap-1.5 text-xs text-secondary">
              <input
                type="checkbox"
                checked={Boolean(item.keepPrivate)}
                onChange={(e) => onKeepPrivateChange(e.target.checked)}
                className="rounded border-hairline"
              />
              Keep private (public skills join the shared library and can't be renamed later)
            </label>
          )}
        </div>
      )}
    </Row>
  )
}

function CourseRow({ item, checked, alreadyExists, onToggle, onChange }) {
  return (
    <Row checked={checked && !alreadyExists} onToggle={onToggle} disabled={alreadyExists}>
      <input
        value={item.name}
        onChange={(e) => onChange(e.target.value)}
        disabled={alreadyExists}
        className="w-full bg-transparent font-display text-ink border-b border-transparent focus:border-hairline focus:outline-none disabled:opacity-60"
      />
      <p className="text-xs text-secondary mt-0.5">
        {item.provider}
        {item.completed_date ? ` · ${formatMonthYear(item.completed_date)}` : ''}
        {alreadyExists ? ' · Already in your profile' : ''}
      </p>
    </Row>
  )
}

function ExperienceRow({ item, checked, alreadyExists, onToggle, onChange }) {
  return (
    <Row checked={checked && !alreadyExists} onToggle={onToggle} disabled={alreadyExists}>
      <input
        value={item.title}
        onChange={(e) => onChange(e.target.value)}
        disabled={alreadyExists}
        className="w-full bg-transparent font-display text-ink border-b border-transparent focus:border-hairline focus:outline-none disabled:opacity-60"
      />
      <p className="text-xs text-secondary mt-0.5">
        {item.organization} · {item.type === 'education' ? 'Education' : 'Employment'} ·{' '}
        {formatMonthYear(item.start_date)} –{' '}
        {item.end_date ? formatMonthYear(item.end_date) : 'Present'}
        {alreadyExists ? ' · Already in your profile' : ''}
      </p>
    </Row>
  )
}
