import { useState } from 'react'
import { updateLibrarySkill } from '../../lib/admin/skills'
import { generateLevelGuide, isCompleteLevelGuide } from '../../lib/levelGuide'
import { KNOWLEDGE_LEVEL_LABELS, LEVEL_LABELS, LEVELS } from '../../lib/levels'

const MAX_STATEMENT_LENGTH = 500

const AXES = [
  {
    axis: 'knowledge',
    column: 'knowledge_level_guide',
    title: 'Knowledge',
    hint: 'What someone understands in theory at each level.',
    labels: KNOWLEDGE_LEVEL_LABELS,
  },
  {
    axis: 'practical',
    column: 'practical_level_guide',
    title: 'Practical ability',
    hint: 'What someone can actually do at each level.',
    labels: LEVEL_LABELS,
  },
]

// The skill's shared level definitions -- the one copy every learner
// tracking this library skill sees when rating themselves, setting targets
// and reading their history (see src/lib/levelGuide.js). Generated once,
// then editable here by a platform admin (skill_library's update policy,
// 0066, is platform-admin only).
export default function LevelDefinitionsSection({ skill, onSkillChange }) {
  return (
    <div>
      <h3 className="font-display text-lg text-ink mb-1">Level definitions</h3>
      <p className="text-xs text-secondary mb-2">
        Everyone tracking {skill.name} sees these same descriptions. Edits apply straight away.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {AXES.map((config) => (
          <AxisDefinitions key={config.axis} skill={skill} config={config} onSkillChange={onSkillChange} />
        ))}
      </div>
    </div>
  )
}

function AxisDefinitions({ skill, config, onSkillChange }) {
  const { axis, column, title, hint, labels } = config
  const current = isCompleteLevelGuide(skill[column]) ? skill[column] : null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function startEditing() {
    setDraft(current ? [...current] : ['', '', '', '', ''])
    setError(null)
    setEditing(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    const statements = draft.map((s) => s.trim())
    if (statements.some((s) => !s)) {
      setError('Every level needs a description.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateLibrarySkill(skill.id, { [column]: statements })
      onSkillChange({ ...skill, [column]: statements })
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleGenerate() {
    setBusy(true)
    setError(null)
    try {
      // Server generates from the library entry's name and stores it on
      // the shared row (only if still empty), returning the stored copy.
      const statements = await generateLevelGuide(axis, skill.name, skill.id)
      if (!isCompleteLevelGuide(statements)) throw new Error("Couldn't generate definitions for this skill.")
      onSkillChange({ ...skill, [column]: statements })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const headingId = `level-definitions-${axis}`

  return (
    <section aria-labelledby={headingId} className="bg-card border border-hairline rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h4 id={headingId} className="text-ink font-medium">
            {title}
          </h4>
          <p className="text-xs text-secondary">{hint}</p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEditing}
            disabled={busy}
            className="shrink-0 rounded-md border border-hairline text-ink py-1 px-2.5 text-xs font-medium hover:bg-paper disabled:opacity-60"
          >
            {current ? 'Edit' : 'Write manually'}
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="space-y-3">
          {LEVELS.map((level, i) => (
            <div key={level}>
              <label htmlFor={`${headingId}-${level}`} className="block text-xs font-medium text-ink mb-1">
                {level}. {labels[level]}
              </label>
              <textarea
                id={`${headingId}-${level}`}
                rows={2}
                maxLength={MAX_STATEMENT_LENGTH}
                value={draft[i] ?? ''}
                onChange={(e) => setDraft((d) => d.map((s, j) => (j === i ? e.target.value : s)))}
                className="w-full rounded-md border border-hairline bg-paper px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save definitions'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : current ? (
        <ol className="space-y-2">
          {LEVELS.map((level, i) => (
            <li key={level} className="text-sm">
              <span className="text-ink font-medium">
                {level}. {labels[level]}
              </span>
              <p className="text-secondary text-xs mt-0.5">{current[i]}</p>
            </li>
          ))}
        </ol>
      ) : (
        <div>
          <p className="text-sm text-secondary">
            Not created yet. They'll be generated automatically the first time someone needs them, or you can
            generate them now.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="mt-3 rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {busy ? 'Generating…' : 'Generate now'}
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-700 mt-2">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
