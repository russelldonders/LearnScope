import { useEffect, useState } from 'react'
import GrowthRing from './GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { activityName, verbLabel } from '../lib/xapiStatement'
import { fetchPeerRaterProgress, buildWeightedPeerRatings } from '../lib/baselineAssessment'
import { validateSkillAgainstTarget, saveValidationResult } from '../lib/skillValidation'

export default function ValidateSkillModal({
  skill,
  user,
  target,
  assessments,
  peerRatings,
  statements,
  quizzes,
  courseLinks,
  onClose,
  onValidated,
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

        const activities = statements.map((s) => ({
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

        const courses = courseLinks
          .filter((l) => l.courses?.completed_date)
          .map((l) => ({ name: l.courses.name, date: new Date(l.courses.completed_date).toLocaleDateString() }))

        const res = await validateSkillAgainstTarget({
          skill,
          targetLevel: target.target_level,
          selfLevel: latestSelf?.level ?? null,
          selfComments: latestSelf?.comments,
          activities,
          quizzes: quizPayload,
          peerRatings: weightedPeerRatings,
          courses,
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

  async function handleConfirm(goToDeveloping) {
    setSaving(true)
    try {
      await saveValidationResult(user, skill, result, goToDeveloping)
      onValidated()
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
        <h2 className="font-display text-2xl text-ink mb-1">AI Assessment</h2>
        <p className="text-sm text-secondary mb-4">
          {skill.name} · Target: {LEVEL_LABELS[target.target_level]}
        </p>

        {loading && (
          <p className="text-sm text-secondary">
            Weighing training, self-assessment, peer ratings, activity and quiz results against your target…
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {result && !loading && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <GrowthRing level={result.level} size={48} />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">Current level</p>
                <p className="text-ink font-medium">{LEVEL_LABELS[result.level]}</p>
              </div>
            </div>

            <p
              className={`font-mono text-xs uppercase tracking-wide rounded-full px-2.5 py-1 inline-block mb-3 border ${
                result.passed ? 'text-moss border-moss bg-moss/10' : 'text-gold border-gold bg-gold/10'
              }`}
            >
              {result.passed ? `Target reached` : 'Target not yet reached'}
            </p>

            <p className="text-sm text-ink mb-4">{result.feedback}</p>

            {result.passed ? (
              <>
                <p className="text-xs text-secondary mb-4">
                  Confirming will save this assessment to the timeline and move the skill to the "Maintaining"
                  stage.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleConfirm(false)}
                    disabled={saving}
                    className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Confirm & move to Maintaining'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-secondary mb-4">
                  Save this assessment to the timeline, and choose whether to keep trying at this stage or send
                  the skill back to "Developing" to build up more evidence first.
                </p>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleConfirm(false)}
                    disabled={saving}
                    className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save feedback & keep trying'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirm(true)}
                    disabled={saving}
                    className="w-full rounded-md border border-hairline text-ink py-2 font-medium hover:bg-paper disabled:opacity-60"
                  >
                    Save feedback & go back to Developing
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="w-full text-sm text-secondary hover:text-ink py-1"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
