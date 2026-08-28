import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from './GrowthRing'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { fetchOrGenerateDiagnosticQuiz, saveDiagnosticAttempt } from '../lib/skillDiagnostics'
import AccessibleDialog from './AccessibleDialog'

// A learner is judged to genuinely be at the level they self-assessed if
// they get at least 70% of the calibrated questions right; below that, the
// confirmed level steps down one, rather than leaving them at a level the
// quiz itself just showed they don't yet support.
const PASS_THRESHOLD = 0.7

// The Confirming Baseline stage's one action: a knowledge-check quiz. Two
// modes:
//   - Confirming (the normal case): pitched once at the level the learner
//     already self-assessed (skill.knowledge_level, falling back to their
//     latest knowledge self-assessment). Pass/fail either confirms that
//     level or steps it down by one -- it never promotes beyond what was
//     claimed.
//   - Calibrating (calibrating=true, from SkillDetail.jsx: no self-assessment
//     and no prior confirmation exist to pitch at): there's nothing to
//     confirm yet, so instead of silently assuming "Unfamiliar", this walks
//     the 1-5 scale from the middle -- passing steps up a level, failing
//     steps down -- until it lands on the boundary between the highest
//     level that passes and the lowest that doesn't. That boundary is the
//     diagnosed level. Bounded to 2-3 rounds since there are only 5 levels,
//     and each round reuses the exact same cached per-level quiz content
//     fetchOrGenerateDiagnosticQuiz already provides -- no new caching model
//     needed for this.
export default function ConfirmingBaselineQuizModal({
  skill,
  user,
  actor,
  latestKnowledgeAssessment,
  calibrating = false,
  onClose,
  onConfirmed,
}) {
  // The latest knowledge-axis event wins, same reasoning as
  // displayedKnowledgeLevel in SkillDetail.jsx: a self-assessment made after
  // the last confirmation is a claim of having grown beyond it, so the quiz
  // should pitch at that new claim, not silently keep testing the old
  // confirmed level forever. When calibrating there's no claim to pitch at
  // yet, so this starts from the middle of the scale instead.
  const startLevel = calibrating ? 3 : (latestKnowledgeAssessment?.level ?? skill.knowledge_level ?? 1)

  const [roundLevel, setRoundLevel] = useState(startLevel)
  // Calibration bracket: the highest level confirmed to pass (0 = none yet)
  // and the lowest confirmed to fail (6 = none yet) -- narrows every round
  // so a level whose outcome is already implied never gets re-tested.
  const [lowPass, setLowPass] = useState(0)
  const [highFail, setHighFail] = useState(6)
  const [roundHistory, setRoundHistory] = useState([])
  const [diagnosedLevel, setDiagnosedLevel] = useState(null)

  const [diagnosticContentId, setDiagnosticContentId] = useState(null)
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [settled, setSettled] = useState(false)
  const [savingRound, setSavingRound] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchOrGenerateDiagnosticQuiz({ skill, level: roundLevel })
      .then(({ diagnosticContentId: id, content: c }) => {
        if (cancelled) return
        if (!c?.questions?.length) throw new Error("Couldn't generate a knowledge check for this skill.")
        setDiagnosticContentId(id)
        setContent(c)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [roundLevel])

  async function next() {
    const updated = [...answers, selected]
    setAnswers(updated)
    setSelected(null)
    if (index + 1 < content.questions.length) {
      setIndex(index + 1)
      return
    }
    await finishRound(updated)
  }

  async function finishRound(roundAnswers) {
    const total = content.questions.length
    const score = content.questions.reduce(
      (acc, q, i) => acc + (q.correctResponsesPattern[0] === roundAnswers[i] ? 1 : 0),
      0
    )
    const pass = total > 0 && score / total >= PASS_THRESHOLD

    // Every round's attempt is its own piece of evidence, saved as soon as
    // it's scored -- same "one xAPI statement per completed attempt"
    // precedent the confirming path already follows, just possibly more
    // than one per session here.
    setSavingRound(true)
    setError(null)
    try {
      await saveDiagnosticAttempt({
        user,
        actor,
        skill,
        diagnosticContentId,
        content,
        answers: roundAnswers,
        calibratedLevel: roundLevel,
        confirmedLevel: pass ? roundLevel : Math.max(1, roundLevel - 1),
      })
    } catch (err) {
      setError(err.message)
      setSavingRound(false)
      return
    }
    setSavingRound(false)

    setRoundHistory((prev) => [...prev, { level: roundLevel, score, total, pass }])

    if (!calibrating) {
      setDiagnosedLevel(pass ? roundLevel : Math.max(1, roundLevel - 1))
      setSettled(true)
      return
    }

    if (pass) {
      const nextLowPass = roundLevel
      setLowPass(nextLowPass)
      // Nothing left to learn by going up if the next level is already
      // known to fail (or there is no next level).
      if (roundLevel + 1 >= highFail) {
        setDiagnosedLevel(nextLowPass)
        setSettled(true)
        return
      }
      setRoundLevel(roundLevel + 1)
    } else {
      const nextHighFail = roundLevel
      setHighFail(nextHighFail)
      // Nothing left to learn by going down if the level below is already
      // known to pass (or we're already at the floor).
      if (roundLevel - 1 <= lowPass) {
        setDiagnosedLevel(Math.max(1, lowPass))
        setSettled(true)
        return
      }
      setRoundLevel(roundLevel - 1)
    }
    setIndex(0)
    setAnswers([])
    setContent(null)
  }

  function buildComments() {
    if (!calibrating) {
      const round = roundHistory[0]
      return round.pass
        ? `Confirmed via knowledge check: scored ${round.score}/${round.total} at ${KNOWLEDGE_LEVEL_LABELS[round.level]}, meeting expectations for that level.`
        : `Confirmed via knowledge check: scored ${round.score}/${round.total} at ${KNOWLEDGE_LEVEL_LABELS[round.level]}, below expectations for that level -- adjusted to ${KNOWLEDGE_LEVEL_LABELS[diagnosedLevel]}.`
    }
    const path = roundHistory
      .map((r) => `${KNOWLEDGE_LEVEL_LABELS[r.level]} (${r.score}/${r.total}, ${r.pass ? 'passed' : 'below expectations'})`)
      .join(' → ')
    return `Calibrated via knowledge check -- no self-assessment existed to pitch at, so this found the level from scratch: ${path}. Diagnosed at ${KNOWLEDGE_LEVEL_LABELS[diagnosedLevel]}.`
  }

  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      const { error: assessError } = await supabase.from('skill_assessments').insert({
        skill_id: skill.id,
        user_id: user.id,
        level: diagnosedLevel,
        axis: 'knowledge',
        source: 'diagnostic_confirmed',
        comments: buildComments(),
      })
      if (assessError) throw assessError

      // Only resolve the confirming_baseline sub-stage back to identified when
      // that's genuinely where the skill still is -- this quiz is now reachable
      // at any point in a skill's life (not just fresh off self-assessing
      // knowledge), and forcing the stage backwards for a skill that has since
      // moved on (e.g. validated) would regress its displayed progress.
      const skillUpdate = { knowledge_level: diagnosedLevel }
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
    <AccessibleDialog
      labelledBy="knowledge-quiz-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <h2 id="knowledge-quiz-dialog-title" className="font-display text-2xl text-ink mb-1">
          {calibrating ? 'Find your knowledge level' : 'Confirm your knowledge'}
        </h2>
        <p className="text-sm text-secondary mb-4">
          {skill.name} ·{' '}
          {settled
            ? `diagnosed at ${KNOWLEDGE_LEVEL_LABELS[diagnosedLevel]}`
            : `checking ${KNOWLEDGE_LEVEL_LABELS[roundLevel]}`}
        </p>

        {loading && (
          <p className="text-sm text-secondary">
            {roundHistory.length > 0 ? 'Preparing your next check…' : 'Generating your knowledge check…'}
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {!loading && !error && !settled && content && (
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
                disabled={selected === null || savingRound}
                className="flex-1 rounded-md bg-slate py-2 font-medium text-paper hover:opacity-90 disabled:opacity-60"
              >
                {savingRound ? 'Saving…' : index + 1 < content.questions.length ? 'Next' : 'Finish'}
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

        {settled && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <GrowthRing level={diagnosedLevel} size={48} labels={KNOWLEDGE_LEVEL_LABELS} color="var(--color-slate)" />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  {calibrating ? 'Diagnosed knowledge level' : 'Confirmed knowledge level'}
                </p>
                <p className="text-ink font-medium">{KNOWLEDGE_LEVEL_LABELS[diagnosedLevel]}</p>
              </div>
            </div>

            {calibrating ? (
              <p className="text-sm text-ink mb-4">
                No self-assessment to start from, so this checked {roundHistory.length} level
                {roundHistory.length === 1 ? '' : 's'} ({roundHistory.map((r) => KNOWLEDGE_LEVEL_LABELS[r.level]).join(' → ')})
                to find where you genuinely land.
              </p>
            ) : (
              <p className="text-sm text-ink mb-4">
                You scored <strong>{roundHistory[0].score} / {roundHistory[0].total}</strong> at the{' '}
                {KNOWLEDGE_LEVEL_LABELS[roundHistory[0].level]} level
                {roundHistory[0].pass
                  ? ' -- that meets expectations, so this is now your confirmed knowledge level.'
                  : ` -- that's below what's expected at that level, so your confirmed level has been adjusted to ${KNOWLEDGE_LEVEL_LABELS[diagnosedLevel]}.`}
              </p>
            )}

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
    </AccessibleDialog>
  )
}
