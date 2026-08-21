import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from './GrowthRing'
import { LEVELS, LEVEL_LABELS, LEVEL_DESCRIPTIONS } from '../lib/levels'
import { ensurePracticalLevelGuide } from '../lib/practicalLevelGuide'

// currentLevel is the panel's already-displayed practical level (falls back
// through self-assessment history the same way the Can Do panel does -- see
// displayedPracticalLevel in SkillDetail) so the default target selection
// and "current" badge reflect what the learner actually sees on the page.
export default function SetTargetModal({ skill, user, targets = [], currentLevel = null, onClose, onSet, onGuideGenerated }) {
  const current = targets[0] ?? null
  const isEdit = Boolean(current)
  const [targetLevel, setTargetLevel] = useState(current?.target_level ?? currentLevel ?? 3)
  const [targetDate, setTargetDate] = useState(current?.target_date ?? '')
  const [comments, setComments] = useState(current?.comments ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [guideStatements, setGuideStatements] = useState([])

  // Same per-skill AI guide as the self-assess picker (see
  // ensurePracticalLevelGuide) -- LEVEL_DESCRIPTIONS is only a fallback
  // while it's loading or if generation fails.
  useEffect(() => {
    let cancelled = false
    ensurePracticalLevelGuide(skill)
      .then((statements) => {
        if (!cancelled) setGuideStatements(statements)
        if (statements.length === 5) onGuideGenerated?.(statements)
      })
      .catch(() => {
        if (!cancelled) setGuideStatements([])
      })
    return () => {
      cancelled = true
    }
  }, [skill.id])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!targetDate) {
      setError('Target date is required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const { error: insertError } = await supabase.from('skill_targets').insert({
        skill_id: skill.id,
        user_id: user.id,
        target_level: targetLevel,
        target_date: targetDate,
        comments: comments.trim() || null,
      })
      if (insertError) throw insertError

      if (skill.lifecycle_stage === 'baseline_assessed') {
        const { error: skillError } = await supabase
          .from('skills')
          .update({ lifecycle_stage: 'target_set' })
          .eq('id', skill.id)
        if (skillError) throw skillError
      }

      onSet()
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
        <h2 className="font-display text-2xl text-ink mb-1">{isEdit ? 'Edit target' : 'Set a target'}</h2>
        <p className="text-sm text-secondary mb-4">{skill.name}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <span className="block text-sm text-secondary mb-2">Target level</span>
            <div className="space-y-2">
              {LEVELS.map((l) => (
                <div
                  key={l}
                  className={`rounded-md border overflow-hidden ${
                    targetLevel === l ? 'border-moss' : 'border-hairline'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setTargetLevel(l)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      targetLevel === l ? 'bg-moss/10' : 'hover:bg-paper'
                    }`}
                  >
                    <GrowthRing level={l} size={28} />
                    <span className="text-sm text-ink font-medium">{LEVEL_LABELS[l]}</span>
                    {currentLevel === l && (
                      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70">
                        Current
                      </span>
                    )}
                    {current?.target_level === l && (
                      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70">
                        Current target
                      </span>
                    )}
                  </button>
                  {targetLevel === l && (guideStatements[l - 1] ?? LEVEL_DESCRIPTIONS[l]) && (
                    <div className="px-3 pt-2 pb-4">
                      <p className="text-xs text-secondary leading-relaxed">
                        {guideStatements[l - 1] ?? LEVEL_DESCRIPTIONS[l]}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-secondary mb-1" htmlFor="targetDate">
              Achieve by
            </label>
            <input
              id="targetDate"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
            />
          </div>

          <textarea
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Why this target? What will getting there look like…"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : isEdit ? 'Save new target' : 'Set target'}
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

        {targets.length > 0 && (
          <div className="mt-6 pt-4 border-t border-hairline opacity-50">
            <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">
              Target history
            </h3>
            <ul className="space-y-2">
              {targets.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <GrowthRing level={t.target_level} size={28} />
                  <div className="min-w-0">
                    <p className="text-ink">{LEVEL_LABELS[t.target_level]}</p>
                    <p className="font-mono text-xs text-secondary">
                      By {new Date(`${t.target_date}T00:00:00`).toLocaleDateString()} · set{' '}
                      {new Date(t.created_at).toLocaleDateString()}
                    </p>
                    {t.comments && <p className="text-xs text-secondary mt-0.5">{t.comments}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
