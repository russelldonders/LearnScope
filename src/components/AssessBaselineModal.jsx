import { useEffect, useState } from 'react'
import GrowthRing from './GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { activityName, verbLabel } from '../lib/xapiStatement'
import {
  fetchPeerRaterProgress,
  buildWeightedPeerRatings,
  assessBaseline,
  saveBaselineAssessment,
} from '../lib/baselineAssessment'

export default function AssessBaselineModal({
  skill,
  user,
  assessments,
  peerRatings,
  statements,
  quizzes,
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
        const latestSelf = assessments
          .filter((a) => a.source === 'self' || !a.source)
          .sort((a, b) => new Date(b.assessed_at) - new Date(a.assessed_at))[0]

        const raterProgress = peerRatings.length > 0 ? await fetchPeerRaterProgress(skill.id) : []
        const weightedPeerRatings = buildWeightedPeerRatings(peerRatings, raterProgress)

        const experiences = statements.map((s) => ({
          verb: verbLabel(s.statement),
          activity: activityName(s.statement),
          description: s.statement.object?.definition?.description?.['en-US'] ?? null,
          date: new Date(s.recorded_at).toLocaleDateString(),
        }))

        const quizPayload = quizzes.map((q) => ({
          score: q.score,
          total: q.total,
          date: new Date(q.created_at).toLocaleDateString(),
        }))

        const res = await assessBaseline({
          skill,
          selfLevel: skill.level,
          selfComments: latestSelf?.comments,
          experiences,
          quizzes: quizPayload,
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
      await saveBaselineAssessment(user, skill, result.level, result.reasoning)
      onAssessed()
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
        <h2 className="font-display text-2xl text-ink mb-1">Assess baseline</h2>
        <p className="text-sm text-secondary mb-4">{skill.name}</p>

        {loading && (
          <p className="text-sm text-secondary">
            Weighing self-assessment, peer ratings, activity and quiz results…
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {result && !loading && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <GrowthRing level={result.level} size={48} />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  Proposed baseline
                </p>
                <p className="text-ink font-medium">{LEVEL_LABELS[result.level]}</p>
              </div>
            </div>
            <p className="text-sm text-ink mb-4">{result.reasoning}</p>
            <p className="text-xs text-secondary mb-4">
              Confirming will set this as the skill's current level, save it to the history, and move
              the skill to the "Baseline assessed" stage.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={saving}
                className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Confirm baseline'}
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
