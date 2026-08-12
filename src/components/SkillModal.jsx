import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { listLibrarySkills, findOrCreateLibrarySkill } from '../lib/skillLibrary'
import GrowthRing from './GrowthRing'
import EvidenceFields from './EvidenceFields'
import TrackingReasonPicker from './TrackingReasonPicker'
import { LEVELS, LEVEL_LABELS } from '../lib/levels'
import { SKILL_LIFECYCLE_STAGES } from '../lib/skillLifecycle'

export default function SkillModal({ categories, onClose, onCreated }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [librarySkills, setLibrarySkills] = useState([])
  const [isCurrentRole, setIsCurrentRole] = useState(false)
  const [trackingReason, setTrackingReason] = useState(null)
  const [lifecycleStage, setLifecycleStage] = useState('identified')
  const [assessNow, setAssessNow] = useState(false)
  const [level, setLevel] = useState(1)
  const [comments, setComments] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listLibrarySkills().then(setLibrarySkills)
  }, [])

  function handleNameChange(value) {
    setName(value)
    if (!category.trim()) {
      const match = librarySkills.find((s) => s.name.toLowerCase() === value.trim().toLowerCase())
      if (match?.category) setCategory(match.category)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !category.trim()) {
      setError('Name and category are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const libraryId = await findOrCreateLibrarySkill(name, category, user.id)
      const { data: skill, error: skillError } = await supabase
        .from('skills')
        .insert({
          name: name.trim(),
          category: category.trim(),
          level: assessNow ? level : null,
          is_current_role: isCurrentRole,
          tracking_reason: trackingReason,
          lifecycle_stage: lifecycleStage,
          library_skill_id: libraryId,
          user_id: user.id,
        })
        .select()
        .single()
      if (skillError) throw skillError

      if (assessNow) {
        const { data: assessment, error: assessmentError } = await supabase
          .from('skill_assessments')
          .insert({
            skill_id: skill.id,
            user_id: user.id,
            level,
            comments: comments.trim() || null,
            evidence_url: evidenceUrl.trim() || null,
          })
          .select()
          .single()
        if (assessmentError) throw assessmentError

        if (evidenceFiles.length > 0) {
          const paths = await uploadEvidenceFiles(user.id, skill.id, assessment.id, evidenceFiles)
          const { error: updateError } = await supabase
            .from('skill_assessments')
            .update({ evidence_paths: paths })
            .eq('id', assessment.id)
          if (updateError) throw updateError
        }
      }

      onCreated()
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
        <h2 className="font-display text-2xl text-ink mb-4">Add a skill</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              required
              list="skill-library-options"
              placeholder="Search the skill library or type a new one…"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <datalist id="skill-library-options">
              {librarySkills.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="category">
              Category
            </label>
            <input
              id="category"
              required
              list="category-options"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
            <datalist id="category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="lifecycleStage">
              Lifecycle stage
            </label>
            <select
              id="lifecycleStage"
              value={lifecycleStage}
              onChange={(e) => setLifecycleStage(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              {SKILL_LIFECYCLE_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={isCurrentRole}
              onChange={(e) => setIsCurrentRole(e.target.checked)}
              className="rounded border-hairline"
            />
            Part of my current role
          </label>

          <TrackingReasonPicker value={trackingReason} onChange={setTrackingReason} />

          <label className="flex items-center gap-2 text-sm text-secondary border-t border-hairline pt-4">
            <input
              type="checkbox"
              checked={assessNow}
              onChange={(e) => setAssessNow(e.target.checked)}
              className="rounded border-hairline"
            />
            Self-assess this skill now
          </label>

          {assessNow ? (
            <>
              <div>
                <span className="block text-sm text-secondary mb-2">Level</span>
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
                      <GrowthRing level={l} size={40} />
                      <span className="font-mono text-[10px] text-secondary">{LEVEL_LABELS[l]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="comments">
                  Why this level? (optional)
                </label>
                <textarea
                  id="comments"
                  rows={3}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Context, examples, self-assessment notes…"
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>

              <EvidenceFields
                evidenceUrl={evidenceUrl}
                onEvidenceUrlChange={setEvidenceUrl}
                files={evidenceFiles}
                onFilesChange={setEvidenceFiles}
              />
            </>
          ) : (
            <p className="text-xs text-secondary">
              You can self-assess this skill any time from its card.
            </p>
          )}

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
          </div>
        </form>
      </div>
    </div>
  )
}
