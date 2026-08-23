import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { computeNextSelfAssessmentDate, todayDateString } from '../lib/checkin'
import GrowthRing from './GrowthRing'
import EvidenceFields from './EvidenceFields'
import { LEVELS, LEVEL_LABELS, LEVEL_DESCRIPTIONS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { ensureKnowledgeLevelGuide } from '../lib/knowledgeLevelGuide'
import { ensurePracticalLevelGuide } from '../lib/practicalLevelGuide'

// currentLevel is the panel's already-displayed level (falls back through
// self-assessment history the same way the panel does -- see
// displayedKnowledgeLevel/displayedPracticalLevel in SkillDetail) so the
// picker's default selection and "current" badge match what the learner
// actually sees before opening this, not the raw skill.level/
// knowledge_level which stays null until a baseline is formally evaluated.
export default function SelfAssessSection({
  skill,
  user,
  axis = 'practical',
  currentLevel = null,
  onAssessed,
  onGuideGenerated,
  submitLabel = 'Save self-assessment',
  secondaryAction = null,
}) {
  const isKnowledge = axis === 'knowledge'
  const labels = isKnowledge ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
  // Once a knowledge level has been confirmed via the quiz, a later
  // self-assessment can only claim that level or higher -- selecting lower
  // would silently contradict a result the learner already demonstrated.
  // No such floor exists for practical (nothing plays an equivalent
  // "verified, can't walk back" role there).
  const confirmedFloor = isKnowledge ? skill.knowledge_level : null
  const [level, setLevel] = useState(Math.max(currentLevel ?? 1, confirmedFloor ?? 1))
  const [comments, setComments] = useState('')
  const [showEvidence, setShowEvidence] = useState(false)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [guideStatements, setGuideStatements] = useState([])
  const [guideLoading, setGuideLoading] = useState(true)
  // The check-in cadence is a practical-review schedule (see handleSubmit),
  // so these only ever apply/render for the practical axis. Defaults to the
  // already-recurring schedule advanced forward from today, same as the old
  // silent auto-advance did -- just visible and editable now instead of
  // happening invisibly.
  const [nextCheckinDate, setNextCheckinDate] = useState(() => {
    if (isKnowledge) return ''
    if (skill.checkin_frequency_value && skill.checkin_frequency_unit) {
      return computeNextSelfAssessmentDate(null, skill.checkin_frequency_value, skill.checkin_frequency_unit)
    }
    return skill.next_checkin_date ?? ''
  })
  const [recurring, setRecurring] = useState(!isKnowledge && Boolean(skill.checkin_frequency_unit))
  const [frequencyValue, setFrequencyValue] = useState(skill.checkin_frequency_value ?? 1)
  const [frequencyUnit, setFrequencyUnit] = useState(skill.checkin_frequency_unit ?? 'months')

  useEffect(() => {
    let cancelled = false
    setGuideLoading(true)
    const ensureGuide = isKnowledge ? ensureKnowledgeLevelGuide : ensurePracticalLevelGuide
    ensureGuide(skill)
      .then((statements) => {
        if (!cancelled) setGuideStatements(statements)
        // Cache the result on the in-memory skill too, so reopening this
        // modal in the same session doesn't hit the DB/AI call again.
        if (statements.length === 5) onGuideGenerated?.(statements)
      })
      .catch(() => {
        // Guidance is a nice-to-have, not required to self-assess -- fail
        // quietly and just fall back to the plain level picker (practical
        // still has LEVEL_DESCRIPTIONS as a static fallback, see render).
        if (!cancelled) setGuideStatements([])
      })
      .finally(() => {
        if (!cancelled) setGuideLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isKnowledge, skill.id])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!isKnowledge && nextCheckinDate && nextCheckinDate < todayDateString()) {
      setError("Next self-assessment date can't be in the past.")
      return
    }
    setSaving(true)
    try {
      const { data: assessment, error: assessmentError } = await supabase
        .from('skill_assessments')
        .insert({
          skill_id: skill.id,
          user_id: user.id,
          level,
          axis,
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

      // A self-assessment is recorded as history but doesn't move the
      // skill's official current level -- only an explicit "Assess
      // baseline" / "Evaluate Baseline" (practical) or the Confirming
      // Baseline quiz / "Confirm knowledge level" (knowledge) action does
      // that. The check-in cadence is a practical-review schedule, so only
      // a practical self-assessment touches it -- explicitly, from whatever
      // the learner set in the schedule fields below, rather than the old
      // silent auto-advance.
      if (!isKnowledge) {
        const { error: skillError } = await supabase
          .from('skills')
          .update({
            next_checkin_date: nextCheckinDate || null,
            checkin_frequency_value: recurring ? Math.max(1, Math.floor(Number(frequencyValue)) || 1) : null,
            checkin_frequency_unit: recurring ? frequencyUnit : null,
          })
          .eq('id', skill.id)
        if (skillError) throw skillError
      }

      // Establishing a baseline's knowledge axis is a self-contained round
      // trip: self-assessing it immediately sends the skill to Confirming
      // Baseline to check it against a calibrated quiz, entirely separate
      // from the practical axis and its own AI-synthesis flow.
      if (isKnowledge && skill.lifecycle_stage === 'identified') {
        const { error: stageError } = await supabase
          .from('skills')
          .update({ lifecycle_stage: 'confirming_baseline' })
          .eq('id', skill.id)
        if (stageError) throw stageError
      }

      onAssessed()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <span className="block text-sm text-secondary mb-2">
          {isKnowledge ? 'What you already know' : 'Level now'}
        </span>
        <div className="space-y-2">
          {LEVELS.map((l) => {
            const locked = confirmedFloor != null && l < confirmedFloor
            // The badge belongs on the confirmed level's own row -- not on
            // the locked rows below it, which was easy to misread as "a
            // higher level is confirmed" attached to the wrong level.
            const isConfirmedRow = confirmedFloor != null && l === confirmedFloor
            const badges = [isConfirmedRow && 'Confirmed', currentLevel === l && 'Current Self-Assess'].filter(Boolean)
            return (
            <div
              key={l}
              className={`rounded-md border overflow-hidden ${
                level === l ? 'border-moss' : isConfirmedRow ? 'border-moss/50' : 'border-hairline'
              } ${locked ? 'opacity-40' : ''}`}
            >
              <button
                type="button"
                onClick={() => !locked && setLevel(l)}
                disabled={locked}
                title={locked ? `Already confirmed at ${labels[confirmedFloor]} -- can't self-assess lower` : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                  locked
                    ? 'cursor-not-allowed'
                    : level === l
                      ? 'bg-moss/10'
                      : isConfirmedRow
                        ? 'bg-moss/5 hover:bg-paper'
                        : 'hover:bg-paper'
                }`}
              >
                <GrowthRing level={l} size={28} labels={labels} color={isKnowledge ? 'var(--color-slate)' : undefined} />
                <span className="text-sm text-ink font-medium">{labels[l]}</span>
                {badges.length > 0 && (
                  <span className="font-mono text-[10px] uppercase tracking-wide text-secondary/70 ml-auto">
                    {badges.join(' · ')}
                  </span>
                )}
              </button>
              {level === l && (
                <div className="px-3 pt-2 pb-4">
                  {(() => {
                    // The practical axis has a static generic fallback
                    // (LEVEL_DESCRIPTIONS) while knowledge doesn't -- but
                    // showing it immediately meant practical never displayed
                    // a loading state at all, just silently swapped the
                    // generic text for the AI-generated one once it arrived.
                    // Loading now always wins first, on both axes, so the
                    // fallback only ever appears once the guide call has
                    // genuinely finished (and failed to produce anything).
                    if (guideLoading) {
                      return <p className="text-xs text-secondary leading-relaxed">Loading guidance…</p>
                    }
                    const levelDescription = guideStatements[l - 1] ?? (!isKnowledge ? LEVEL_DESCRIPTIONS[l] : undefined)
                    return (
                      levelDescription && (
                        <p className="text-xs text-secondary leading-relaxed">{levelDescription}</p>
                      )
                    )
                  })()}
                </div>
              )}
            </div>
            )
          })}
        </div>
      </div>

      <div>
        {isKnowledge && (
          <span className="block text-sm text-secondary mb-2">What's shaped this understanding?</span>
        )}
        <textarea
          rows={3}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder={
            isKnowledge
              ? 'e.g. courses, reading, work you’ve done…'
              : 'Why this level? What changed since last time…'
          }
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
        />
      </div>

      {!isKnowledge && (
        <div>
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={showEvidence}
              onChange={(e) => setShowEvidence(e.target.checked)}
              className="rounded border-hairline"
            />
            Provide evidence
          </label>
          {showEvidence && (
            <EvidenceFields
              evidenceUrl={evidenceUrl}
              onEvidenceUrlChange={setEvidenceUrl}
              files={evidenceFiles}
              onFilesChange={setEvidenceFiles}
            />
          )}
        </div>
      )}

      {!isKnowledge && (
        <div className="border-t border-hairline pt-3 space-y-2">
          <span className="block text-sm text-secondary">Next self-assessment</span>
          <input
            type="date"
            value={nextCheckinDate}
            min={todayDateString()}
            onChange={(e) => setNextCheckinDate(e.target.value)}
            className="w-full min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
          <label className="flex items-center gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
              className="rounded border-hairline"
            />
            Set up regular self-assessments
          </label>
          {recurring && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-secondary">Every</span>
              <input
                type="number"
                min={1}
                value={frequencyValue}
                onChange={(e) => setFrequencyValue(e.target.value)}
                onBlur={(e) => setFrequencyValue(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                className="w-16 min-w-0 rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
              />
              <select
                value={frequencyUnit}
                onChange={(e) => setFrequencyUnit(e.target.value)}
                className="rounded-md border border-hairline bg-paper px-2 py-1.5 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
              >
                <option value="weeks">weeks</option>
                <option value="months">months</option>
                <option value="years">years</option>
              </select>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {saving ? 'Saving…' : submitLabel}
        </button>
        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            disabled={saving}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </form>
  )
}
