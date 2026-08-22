import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from './GrowthRing'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { fetchOrGenerateDiagnosticQuiz, saveDiagnosticAttempt } from '../lib/skillDiagnostics'

// A learner is judged to genuinely be at the level they self-assessed if
// they get at least 70% of the calibrated questions right; below that, the
// confirmed level steps down one, rather than leaving them at a level the
// quiz itself just showed they don't yet support.
const PASS_THRESHOLD = 0.7

// The Confirming Baseline stage's one action: a knowledge-check quiz pitched
// at the level the learner already self-assessed (skill.knowledge_level,
// falling back to their latest knowledge self-assessment), cached and reused
// across learners rather than regenerated per attempt (see
// api/generate-diagnostic-quiz.js). The score directly determines the
// outcome -- no separate manual re-pick -- and one "Continue" action both
// records the attempt and the confirmed level, and sends the skill back to
// Establishing Baseline to pick up the practical axis next.
export default function ConfirmingBaselineQuizModal({
  skill,
  user,
  actor,
  latestKnowledgeAssessment,
  onClose,
  onConfirmed,
}) {
  // The latest knowledge-axis event wins, same reasoning as
  // displayedKnowledgeLevel in SkillDetail.jsx: a self-assessment made after
  // the last confirmation is a claim of having grown beyond it, so the quiz
  // should pitch at that new claim, not silently keep testing the old
  // confirmed level forever. When nothing newer exists, latestKnowledgeAssessment
  // *is* the confirmation (same value as skill.knowledge_level), so this is
  // safe in the normal case too.
  const calibratedLevel = latestKnowledgeAssessment?.level ?? skill.knowledge_level ?? 1

  const [diagnosticContentId, setDiagnosticContentId] = useState(null)
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchOrGenerateDiagnosticQuiz({ skill, level: calibratedLevel })
      .then(({ diagnosticContentId: id, content: c }) => {
        if (!c?.questions?.length) throw new Error("Couldn't generate a knowledge check for this skill.")
        setDiagnosticContentId(id)
        setContent(c)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function next() {
    const updated = [...answers, selected]
    setAnswers(updated)
    setSelected(null)
    if (index + 1 < content.questions.length) {
      setIndex(index + 1)
    } else {
      setFinished(true)
    }
  }

  const score = finished
    ? content.questions.reduce(
        (acc, q, i) => acc + (q.correctResponsesPattern[0] === answers[i] ? 1 : 0),
        0
      )
    : 0
  const total = content?.questions.length ?? 0
  const metExpectations = total > 0 && score / total >= PASS_THRESHOLD
  const confirmedLevel = metExpectations ? calibratedLevel : Math.max(1, calibratedLevel - 1)

  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      await saveDiagnosticAttempt({
        user,
        actor,
        skill,
        diagnosticContentId,
        content,
        answers,
        calibratedLevel,
        confirmedLevel,
      })

      const { error: assessError } = await supabase.from('skill_assessments').insert({
        skill_id: skill.id,
        user_id: user.id,
        level: confirmedLevel,
        axis: 'knowledge',
        source: 'diagnostic_confirmed',
        comments: metExpectations
          ? `Confirmed via knowledge check: scored ${score}/${total} at ${KNOWLEDGE_LEVEL_LABELS[calibratedLevel]}, meeting expectations for that level.`
          : `Confirmed via knowledge check: scored ${score}/${total} at ${KNOWLEDGE_LEVEL_LABELS[calibratedLevel]}, below expectations for that level -- adjusted to ${KNOWLEDGE_LEVEL_LABELS[confirmedLevel]}.`,
      })
      if (assessError) throw assessError

      // Only resolve the confirming_baseline sub-stage back to identified when
      // that's genuinely where the skill still is -- this quiz is now reachable
      // at any point in a skill's life (not just fresh off self-assessing
      // knowledge), and forcing the stage backwards for a skill that has since
      // moved on (e.g. validated) would regress its displayed progress.
      const skillUpdate = { knowledge_level: confirmedLevel }
      if (skill.lifecycle_stage === 'confirming_baseline') skillUpdate.lifecycle_stage = 'identified'
      const { error: skillError } = await supabase.from('skills').update(skillUpdate).eq('id', skill.id)
      if (skillError) throw skillError

      onConfirmed()
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
        <h2 className="font-display text-2xl text-ink mb-1">Confirm your knowledge</h2>
        <p className="text-sm text-secondary mb-4">
          {skill.name} · pitched at {KNOWLEDGE_LEVEL_LABELS[calibratedLevel]}
        </p>

        {loading && <p className="text-sm text-secondary">Generating your knowledge check…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {!loading && !error && !finished && content && (
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">
              Question {index + 1} of {content.questions.length}
            </p>
            <p className="text-sm text-ink mb-3">{content.questions[index].description['en-US']}</p>
            <div className="space-y-2 mb-4">
              {content.questions[index].choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => setSelected(choice.id)}
                  className={`w-full text-left rounded-md border px-3 py-2 text-sm ${
                    selected === choice.id
                      ? 'border-slate bg-slate/10 text-ink'
                      : 'border-hairline text-ink hover:bg-paper'
                  }`}
                >
                  {choice.description['en-US']}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={next}
                disabled={selected === null}
                className="flex-1 rounded-md bg-slate py-2 font-medium text-paper hover:opacity-90 disabled:opacity-60"
              >
                {index + 1 < content.questions.length ? 'Next' : 'Finish'}
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

        {finished && content && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <GrowthRing level={confirmedLevel} size={48} labels={KNOWLEDGE_LEVEL_LABELS} color="var(--color-slate)" />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  Confirmed knowledge level
                </p>
                <p className="text-ink font-medium">{KNOWLEDGE_LEVEL_LABELS[confirmedLevel]}</p>
              </div>
            </div>
            <p className="text-sm text-ink mb-4">
              You scored <strong>{score} / {total}</strong> at the {KNOWLEDGE_LEVEL_LABELS[calibratedLevel]} level
              {metExpectations
                ? ' -- that meets expectations, so this is now your confirmed knowledge level.'
                : ` -- that's below what's expected at that level, so your confirmed level has been adjusted to ${KNOWLEDGE_LEVEL_LABELS[confirmedLevel]}.`}
            </p>

            {error && <p className="text-sm text-red-700 mb-2">{error}</p>}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
