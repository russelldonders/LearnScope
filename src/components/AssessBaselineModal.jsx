import { useEffect, useState } from 'react'
import GrowthRing from './GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { SKILL_LIFECYCLE_LABELS } from '../lib/skillLifecycle'
import { activityName, verbLabel } from '../lib/xapiStatement'
import {
  fetchPeerRaterProgress,
  buildWeightedPeerRatings,
  assessBaseline,
  saveAssessmentResult,
} from '../lib/baselineAssessment'

// mode: 'baseline' (identified -> baseline_assessed, one-time) or
// 'evaluate' (always-available re-assessment). Same synthesis either way --
// only the heading, saved source, and whether the stage advances differ.
export default function AssessBaselineModal({
  skill,
  user,
  assessments,
  peerRatings,
  statements,
  mode = 'baseline',
  onClose,
  onAssessed,
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function run() {
      try {
        // axis === 'practical' matters here -- without it, a more recent
        // knowledge self-assessment could get read as this skill's practical
        // self-rating, leaking knowledge into the practical-only synthesis.
        const latestSelf = assessments
          .filter((a) => (a.source === 'self' || !a.source) && a.axis === 'practical')
          .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))[0]

        const raterProgress = peerRatings.length > 0 ? await fetchPeerRaterProgress(skill.id) : []
        const weightedPeerRatings = buildWeightedPeerRatings(peerRatings, raterProgress)

        const activities = statements.map((s) => ({
          verb: verbLabel(s.statement),
          activity: activityName(s.statement),
          description: s.statement.object?.definition?.description?.['en-US'] ?? null,
          date: new Date(s.recorded_at).toLocaleDateString(),
        }))

        const res = await assessBaseline({
          skill,
          selfLevel: latestSelf?.level ?? null,
          selfComments: latestSelf?.comments,
          activities,
          peerRatings: weightedPeerRatings,
        })
        setResult(res)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [])

  async function handleConfirm() {
    setSaving(true)
    try {
      await saveAssessmentResult(user, skill, result.level, result.reasoning, mode)
      onAssessed()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const heading = mode === 'baseline' ? 'Assess baseline' : 'Evaluate baseline'
  const proposedLabel = 'Proposed baseline'
  const confirmLabel = mode === 'baseline' ? 'Confirm baseline' : 'Update baseline'
  const confirmNote =
    mode === 'baseline'
      ? `Confirming will set this as the skill's current level, save it to the timeline, and move the skill to the "${SKILL_LIFECYCLE_LABELS.baseline_assessed}" stage.`
      : "Confirming will update the skill's current baseline level and add this as a new baseline entry on the timeline -- the previous baseline stays in the history."

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-2xl text-ink mb-1">{heading}</h2>
        <p className="text-sm text-secondary mb-4">{skill.name}</p>

        {loading && (
          <p className="text-sm text-secondary">
            Weighing self-assessment, peer ratings and recorded activity…
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {result && !loading && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <GrowthRing level={result.level} size={48} />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  {proposedLabel}
                </p>
                <p className="text-ink font-medium">{LEVEL_LABELS[result.level]}</p>
              </div>
            </div>
            <p className="text-sm text-ink mb-4">{result.reasoning}</p>
            <p className="text-xs text-secondary mb-4">{confirmNote}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={saving}
                className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : confirmLabel}
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
        )}
      </div>
    </div>
  )
}
