import { useEffect, useState } from 'react'
import { XAPI_VERBS } from '../lib/xapiVerbs'
import { buildStatement, experienceTrail } from '../lib/xapiStatement'
import AccessibleDialog from './AccessibleDialog'
import EvidenceFields from './EvidenceFields'
import SkillPickerModal from './SkillPickerModal'

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

// Remembers which optional sections (duration/notes/evidence) were left open
// last time, so the modal reopens the way the learner last set it up rather
// than always starting collapsed.
const PANELS_STORAGE_KEY = 'ls_record_activity_panels'

function loadPanelPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(PANELS_STORAGE_KEY))
    return {
      duration: Boolean(stored?.duration),
      notes: Boolean(stored?.notes),
      evidence: Boolean(stored?.evidence),
    }
  } catch {
    return { duration: false, notes: false, evidence: false }
  }
}

export default function RecordActivityModal({ actor, skills, experiences = [], relatedSkill: fixedSkill, relatedExperience: fixedExperience, onSave, onClose }) {
  const [verbValue, setVerbValue] = useState('experienced')
  const [activityTitle, setActivityTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayDate())
  const [durationHours, setDurationHours] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [selectedSkills, setSelectedSkills] = useState([])
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [relatedExperienceId, setRelatedExperienceId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [panelPrefs] = useState(loadPanelPreferences)
  const [showDuration, setShowDuration] = useState(panelPrefs.duration)
  const [showNotes, setShowNotes] = useState(panelPrefs.notes)
  const [showEvidence, setShowEvidence] = useState(panelPrefs.evidence)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])

  useEffect(() => {
    localStorage.setItem(
      PANELS_STORAGE_KEY,
      JSON.stringify({ duration: showDuration, notes: showNotes, evidence: showEvidence })
    )
  }, [showDuration, showNotes, showEvidence])
  const selectedExperience = fixedExperience ?? experiences.find((experience) => experience.id === relatedExperienceId)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    let statement
    try {
      if (!activityTitle.trim()) throw new Error('An activity name is required.')
      if (!date) throw new Error('A date is required.')
      const relatedSkills = fixedSkill ? [fixedSkill] : selectedSkills
      if (relatedSkills.length === 0) throw new Error('Choose at least one skill this activity contributed to.')
      const selectedExperience = experiences.find((experience) => experience.id === relatedExperienceId)
      const relatedExperience = fixedExperience ?? selectedExperience ?? null
      statement = buildStatement({
        actor,
        verbValue,
        activityName: activityTitle.trim(),
        description: description.trim() || null,
        timestamp: date,
        relatedSkills,
        relatedExperience,
        durationHours,
        durationMinutes,
      })
    } catch (err) {
      setError(err.message)
      return
    }

    setSaving(true)
    try {
      await onSave(statement, {
        evidenceUrl: evidenceUrl.trim(),
        files: evidenceFiles,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="record-activity-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="record-activity-dialog-title" className="font-display text-2xl text-ink mb-1">Log skill activity</h2>
        <p className="text-sm text-secondary mb-4">
          {fixedExperience
            ? `Capture one thing you did within “${fixedExperience.title}” and the skill(s) it helped you develop.`
            : fixedSkill
              ? `Capture one thing you did that contributed to “${fixedSkill.name}”.`
              : 'Capture one thing you did and the skill(s) it helped you develop.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="activityTitle">
              What did you do?
            </label>
            <input
              id="activityTitle"
              required
              min={selectedExperience?.start_date ?? undefined}
              max={selectedExperience?.end_date ?? undefined}
              value={activityTitle}
              onChange={(e) => setActivityTitle(e.target.value)}
              placeholder={
                fixedSkill
                  ? `something related to "${fixedSkill.name}"…`
                  : 'a retro for the team, a 10k, a production incident…'
              }
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="verb">
              How would you describe it?
            </label>
            <select
              id="verb"
              value={verbValue}
              onChange={(e) => setVerbValue(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              {XAPI_VERBS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="date">
              When?
            </label>
            <input
              id="date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          {!fixedSkill && (
            <div>
              <span className="block text-sm text-secondary mb-1">Skills</span>
              {selectedSkills.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 mb-2">
                  {selectedSkills.map((s) => (
                    <li
                      key={s.id}
                      className="inline-flex items-center gap-1 rounded-full border border-hairline bg-paper pl-2.5 pr-1 py-1 text-xs text-ink"
                    >
                      {s.name}
                      <button
                        type="button"
                        onClick={() => setSelectedSkills((current) => current.filter((sk) => sk.id !== s.id))}
                        aria-label={`Remove ${s.name}`}
                        className="rounded-full p-0.5 text-secondary hover:text-ink"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setSkillPickerOpen(true)}
                className="w-full text-left rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                {selectedSkills.length > 0 ? (
                  '+ Add another skill'
                ) : (
                  <span className="text-secondary">Choose a skill…</span>
                )}
              </button>
            </div>
          )}

          {!fixedExperience && experiences.length > 0 && (
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="relatedExperience">
                Experience context (optional)
              </label>
              <select
                id="relatedExperience"
                value={relatedExperienceId}
                onChange={(e) => setRelatedExperienceId(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">No specific experience</option>
                {experiences.map((experience) => (
                  <option key={experience.id} value={experience.id}>{experienceTrail(experience)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {!showDuration && (
              <button
                type="button"
                onClick={() => setShowDuration(true)}
                className="text-xs text-secondary hover:text-ink underline"
              >
                + Add how long it took
              </button>
            )}
            {!showNotes && (
              <button
                type="button"
                onClick={() => setShowNotes(true)}
                className="text-xs text-secondary hover:text-ink underline"
              >
                + Add more detail
              </button>
            )}
            {!showEvidence && (
              <button
                type="button"
                onClick={() => setShowEvidence(true)}
                className="text-xs text-secondary hover:text-ink underline"
              >
                + Add evidence
              </button>
            )}
          </div>

          {showDuration && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="block text-sm text-secondary">How long did it take?</span>
                <button
                  type="button"
                  onClick={() => setShowDuration(false)}
                  className="text-xs text-secondary hover:text-ink underline"
                >
                  Hide
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={durationHours}
                  onChange={(e) => setDurationHours(e.target.value)}
                  placeholder="0"
                  aria-label="Hours"
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                <span className="text-sm text-secondary shrink-0">h</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  inputMode="numeric"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="0"
                  aria-label="Minutes"
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                <span className="text-sm text-secondary shrink-0">m</span>
              </div>
            </div>
          )}

          {showNotes && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-secondary" htmlFor="description">
                  Anything else worth remembering?
                </label>
                <button
                  type="button"
                  onClick={() => setShowNotes(false)}
                  className="text-xs text-secondary hover:text-ink underline"
                >
                  Hide
                </button>
              </div>
              <textarea
                id="description"
                rows={3}
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Any detail worth remembering…"
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          )}

          {showEvidence && (
            <EvidenceFields
              evidenceUrl={evidenceUrl}
              onEvidenceUrlChange={setEvidenceUrl}
              files={evidenceFiles}
              onFilesChange={setEvidenceFiles}
              onHide={() => setShowEvidence(false)}
            />
          )}

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Log activity'}
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

        {skillPickerOpen && (
          <SkillPickerModal
            activityTitle={activityTitle}
            activityDescription={description}
            skills={skills.filter((s) => !selectedSkills.some((sel) => sel.id === s.id))}
            onConfirm={(newlySelected) => {
              setSelectedSkills((current) => [...current, ...newlySelected])
              setSkillPickerOpen(false)
            }}
            onClose={() => setSkillPickerOpen(false)}
          />
        )}
    </AccessibleDialog>
  )
}
