import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from './GrowthRing'
import { LEVELS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { fetchOrGenerateDiagnosticQuiz, saveDiagnosticAttempt } from '../lib/skillDiagnostics'

// The Confirming Baseline stage's one action: a knowledge-check quiz pitched
// at the level the learner already self-assessed (skill.knowledge_level,
// falling back to their latest knowledge self-assessment), cached and reused
// across learners rather than regenerated per attempt (see
// api/generate-diagnostic-quiz.js). Finishing embeds an explicit
// level-confirm step -- same "learner stays in control" pattern as
// ConfirmKnowledgeLevelModal -- and that one confirm action both records the
// attempt and advances the skill out of this stage.
export default function ConfirmingBaselineQuizModal({
  skill,
  user,
  actor,
  latestKnowledgeAssessment,
  onClose,
  onConfirmed,
}) {
  const calibratedLevel = skill.knowledge_level ?? latestKnowledgeAssessment?.level ?? 1

  const [diagnosticContentId, setDiagnosticContentId] = useState(null)
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [finished, setFinished] = useState(false)
  const [confirmLevel, setConfirmLevel] = useState(calibratedLevel)
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
        confirmedLevel: confirmLevel,
      })

      const { error: assessError } = await supabase.from('skill_assessments').insert({
        skill_id: skill.id,
        user_id: user.id,
        level: confirmLevel,
        axis: 'knowledge',
        source: 'diagnostic_confirmed',
        comments: `Confirmed via ${score}/${content.questions.length} knowledge check`,
      })
      if (assessError) throw assessError

      const { error: skillError } = await supabase
        .from('skills')
        .update({ knowledge_level: confirmLevel, lifecycle_stage: 'baseline_assessed' })
        .eq('id', skill.id)
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
            <p className="text-sm text-ink mb-4">
              You scored <strong>{score} / {content.questions.length}</strong> at the {KNOWLEDGE_LEVEL_LABELS[calibratedLevel]} level.
            </p>

            <div className="mb-4">
              <span className="block text-sm text-secondary mb-2">Confirm your knowledge level</span>
              <div className="flex items-center justify-between">
                {LEVELS.map((l) => (
                  <button
                    type="button"
                    key={l}
                    onClick={() => setConfirmLevel(l)}
                    className={`flex flex-col items-center gap-1 rounded-md px-1 py-1 ${
                      confirmLevel === l ? 'bg-slate/10' : ''
                    }`}
                  >
                    <GrowthRing level={l} size={32} labels={KNOWLEDGE_LEVEL_LABELS} color="var(--color-slate)" />
                    <span className="font-mono text-[10px] text-secondary">{KNOWLEDGE_LEVEL_LABELS[l]}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-700 mb-2">{error}</p>}

            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="w-full rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Confirm and continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
