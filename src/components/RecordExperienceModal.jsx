import { useState } from 'react'
import { XAPI_VERBS } from '../lib/xapiVerbs'
import { buildStatement, validateStatement } from '../lib/xapiStatement'

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

export default function RecordExperienceModal({ actor, skills, relatedCourse, relatedSkill: fixedSkill, onSave, onClose }) {
  const [rawMode, setRawMode] = useState(false)
  const [verbValue, setVerbValue] = useState('experienced')
  const [activityTitle, setActivityTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayDate())
  const [relatedSkillId, setRelatedSkillId] = useState('')
  const [rawJson, setRawJson] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function switchToRaw() {
    if (!rawJson) {
      try {
        const relatedSkill =
          fixedSkill ?? (relatedSkillId ? { id: relatedSkillId, name: skills.find((s) => s.id === relatedSkillId)?.name } : null)
        const statement = buildStatement({
          actor,
          verbValue,
          activityName: activityTitle.trim() || 'Untitled activity',
          description: description.trim() || null,
          timestamp: date,
          relatedSkill,
          relatedCourse,
        })
        setRawJson(JSON.stringify(statement, null, 2))
      } catch {
        setRawJson('{\n  \n}')
      }
    }
    setRawMode(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    let statement
    try {
      if (rawMode) {
        let parsed
        try {
          parsed = JSON.parse(rawJson)
        } catch {
          throw new Error('Raw statement is not valid JSON.')
        }
        const validationError = validateStatement(parsed)
        if (validationError) throw new Error(validationError)
        statement = parsed
      } else {
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
        })
      }
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
        <h2 className="font-display text-2xl text-ink mb-1">Record an experience</h2>
        <p className="text-sm text-secondary mb-4">
          {relatedCourse
            ? `A quick log of something you did as part of "${relatedCourse.name}".`
            : fixedSkill
              ? `A quick log of something you did related to "${fixedSkill.name}".`
              : "A quick log of something you did — separate from your work & education timeline."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!rawMode ? (
            <>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="verb">
                  What happened?
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
                <label className="block text-sm text-secondary mb-1" htmlFor="activityTitle">
                  Activity
                </label>
                <input
                  id="activityTitle"
                  required
                  value={activityTitle}
                  onChange={(e) => setActivityTitle(e.target.value)}
                  placeholder="e.g. Led a retro for the team, Ran a 10k, Fixed a production incident…"
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>

              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="date">
                  Date
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
                        {s.name} ({s.category})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="description">
                  Notes (optional)
                </label>
                <textarea
                  id="description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Any detail worth remembering…"
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>

              <button
                type="button"
                onClick={switchToRaw}
                className="text-xs text-secondary hover:text-ink underline"
              >
                Edit raw xAPI statement JSON instead
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm text-secondary mb-1" htmlFor="rawJson">
                  xAPI statement (JSON)
                </label>
                <textarea
                  id="rawJson"
                  rows={16}
                  value={rawJson}
                  onChange={(e) => setRawJson(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-xs font-mono focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <button
                type="button"
                onClick={() => setRawMode(false)}
                className="text-xs text-secondary hover:text-ink underline"
              >
                Back to guided form
              </button>
            </>
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
