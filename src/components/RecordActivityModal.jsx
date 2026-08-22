import { useState } from 'react'
import { XAPI_VERBS } from '../lib/xapiVerbs'
import { buildStatement } from '../lib/xapiStatement'

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

export default function RecordActivityModal({ actor, skills, relatedCourse, relatedSkill: fixedSkill, onSave, onClose }) {
  const [verbValue, setVerbValue] = useState('experienced')
  const [activityTitle, setActivityTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayDate())
  const [durationHours, setDurationHours] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [relatedSkillId, setRelatedSkillId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showDuration, setShowDuration] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    let statement
    try {
      if (!activityTitle.trim()) throw new Error('An activity name is required.')
      if (!date) throw new Error('A date is required.')
      const relatedSkill =
        fixedSkill ?? (relatedSkillId ? { id: relatedSkillId, name: skills.find((s) => s.id === relatedSkillId)?.name } : null)
      statement = buildStatement({
        actor,
        verbValue,
        activityName: activityTitle.trim(),
        description: description.trim() || null,
        timestamp: date,
        relatedSkill,
        relatedCourse,
        durationHours,
        durationMinutes,
      })
    } catch (err) {
      setError(err.message)
      return
    }

    setSaving(true)
    try {
      await onSave(statement)
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
        <h2 className="font-display text-2xl text-ink mb-1">Record an activity</h2>
        <p className="text-sm text-secondary mb-4">
          {relatedCourse
            ? `A quick log of something you did as part of "${relatedCourse.name}".`
            : fixedSkill
              ? `A quick log of something you did related to "${fixedSkill.name}".`
              : "A quick log of something you did — separate from your work & education timeline."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="activityTitle">
              What happened?
            </label>
            <div className="flex items-stretch gap-2">
              <span className="flex items-center text-ink shrink-0">I</span>
              <select
                id="verb"
                value={verbValue}
                onChange={(e) => setVerbValue(e.target.value)}
                aria-label="What happened"
                className="shrink-0 rounded-md border border-hairline bg-paper pl-2 pr-6 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                {XAPI_VERBS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label.toLowerCase()}
                  </option>
                ))}
              </select>
              <input
                id="activityTitle"
                required
                value={activityTitle}
                onChange={(e) => setActivityTitle(e.target.value)}
                placeholder={
                  fixedSkill
                    ? `something related to "${fixedSkill.name}"…`
                    : 'a retro for the team, a 10k, a production incident…'
                }
                className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
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

          {!fixedSkill && skills.length > 0 && (
            <div>
              <label className="block text-sm text-secondary mb-1" htmlFor="relatedSkill">
                Related skill (optional)
              </label>
              <select
                id="relatedSkill"
                value={relatedSkillId}
                onChange={(e) => setRelatedSkillId(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="">— None —</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
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
          </div>

          {showDuration && (
            <div>
              <span className="block text-sm text-secondary mb-1">How long did it take?</span>
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
              <label className="block text-sm text-secondary mb-1" htmlFor="description">
                Anything else worth remembering?
              </label>
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
