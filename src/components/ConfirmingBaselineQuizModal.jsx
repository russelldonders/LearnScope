import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from './GrowthRing'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { fetchKnowledgeCheckQuestions, saveDiagnosticAttempt } from '../lib/skillDiagnostics'
import { scoreTestQuestion, startingOrder } from '../lib/pageBuilder'
import AccessibleDialog from './AccessibleDialog'
import { useLanguage } from '../context/LanguageContext'

// A learner is judged to genuinely be at the level they self-assessed if
// they get at least 70% of the calibrated questions right; below that, the
// confirmed level steps down one, rather than leaving them at a level the
// quiz itself just showed they don't yet support.
const PASS_THRESHOLD = 0.7

const LOADING_LINES = ['loading1', 'loading2', 'loading3']

const SPARKLES = [
  { dx: '-46px', dy: '-38px', color: 'var(--color-gold)' },
  { dx: '44px', dy: '-42px', color: 'var(--color-moss)' },
  { dx: '-54px', dy: '8px', color: 'var(--color-slate)' },
  { dx: '52px', dy: '12px', color: 'var(--color-gold)' },
  { dx: '-26px', dy: '46px', color: 'var(--color-moss)' },
  { dx: '30px', dy: '44px', color: 'var(--color-slate)' },
  { dx: '0px', dy: '-56px', color: 'var(--color-moss)' },
]

// The Confirming Baseline stage's knowledge check. Questions come from the
// skill's stored question pool for the level being checked (see
// api/generate-diagnostic-quiz.js) -- course-builder scored questions in a
// mix of types, marked with the same scoreTestQuestion() the course player
// uses. Two modes:
//   - Confirming (the normal case): pitched once at the level the learner
//     already self-assessed (skill.knowledge_level, falling back to their
//     latest knowledge self-assessment). Pass/fail either confirms that
//     level or steps it down by one -- it never promotes beyond what was
//     claimed.
//   - Calibrating (calibrating=true, from SkillDetail.jsx: no self-assessment
//     and no prior confirmation exist to pitch at): there's nothing to
//     confirm yet, so this walks the 1-5 scale from the middle -- passing
//     steps up a level, failing steps down -- until it lands on the boundary
//     between the highest level that passes and the lowest that doesn't.
//     Bounded to 2-3 rounds since there are only 5 levels.
export default function ConfirmingBaselineQuizModal({
  skill,
  user,
  actor,
  latestKnowledgeAssessment,
  calibrating = false,
  onClose,
  onConfirmed,
}) {
  const { t } = useLanguage()
  // The latest knowledge-axis event wins, same reasoning as
  // displayedKnowledgeLevel in SkillDetail.jsx: a self-assessment made after
  // the last confirmation is a claim of having grown beyond it, so the quiz
  // should pitch at that new claim. When calibrating there's no claim to
  // pitch at yet, so this starts from the middle of the scale instead.
  const startLevel = calibrating ? 3 : (latestKnowledgeAssessment?.level ?? skill.knowledge_level ?? 1)

  const [stage, setStage] = useState('intro') // intro -> question -> (roundBreak -> question)* -> result
  const [roundLevel, setRoundLevel] = useState(startLevel)
  // Calibration bracket: the highest level confirmed to pass (0 = none yet)
  // and the lowest confirmed to fail (6 = none yet).
  const [lowPass, setLowPass] = useState(0)
  const [highFail, setHighFail] = useState(6)
  const [roundHistory, setRoundHistory] = useState([])
  const [diagnosedLevel, setDiagnosedLevel] = useState(null)

  const [questions, setQuestions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingLine, setLoadingLine] = useState(0)
  const [error, setError] = useState(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [results, setResults] = useState({})
  const [savingRound, setSavingRound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchKnowledgeCheckQuestions({ skill, level: roundLevel })
      .then(({ questions: q }) => {
        if (cancelled) return
        if (!q?.length) throw new Error(t('modals.confirmingBaselineQuiz.couldntGenerateCheck'))
        setQuestions(q)
        setAnswers(Object.fromEntries(q.map((question) => [question.id, initialAnswer(question)])))
        setResults({})
        setIndex(0)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one set of questions per round level, by design
  }, [roundLevel])

  useEffect(() => {
    if (!loading) return undefined
    const id = window.setInterval(() => setLoadingLine((n) => (n + 1) % LOADING_LINES.length), 1800)
    return () => window.clearInterval(id)
  }, [loading])

  const question = questions?.[index] ?? null
  const result = question ? results[question.id] : null
  const answered = question ? isAnswered(question, answers[question.id]) : false
  const answeredAny = Object.keys(results).length > 0 || roundHistory.length > 0

  function checkAnswer() {
    if (!question || !answered || result) return
    setResults((prev) => ({ ...prev, [question.id]: scoreTestQuestion(question, answers[question.id]) }))
  }

  async function nextQuestion() {
    if (index + 1 < questions.length) {
      setIndex(index + 1)
      return
    }
    await finishRound()
  }

  async function finishRound() {
    const total = questions.length
    const score = questions.filter((q) => results[q.id]?.correct).length
    const pass = total > 0 && score / total >= PASS_THRESHOLD

    // Every round is its own piece of evidence, saved as soon as it's scored.
    setSavingRound(true)
    setError(null)
    try {
      await saveDiagnosticAttempt({
        user,
        actor,
        skill,
        questions,
        answers,
        results,
        calibratedLevel: roundLevel,
        confirmedLevel: pass ? roundLevel : Math.max(1, roundLevel - 1),
      })
    } catch (err) {
      setError(err.message)
      setSavingRound(false)
      return
    }
    setSavingRound(false)

    const rounds = [...roundHistory, { level: roundLevel, score, total, pass }]
    setRoundHistory(rounds)

    if (!calibrating) {
      settle(pass ? roundLevel : Math.max(1, roundLevel - 1), rounds)
      return
    }

    if (pass) {
      setLowPass(roundLevel)
      if (roundLevel + 1 >= highFail) {
        settle(roundLevel, rounds)
        return
      }
      startNextRound(roundLevel + 1)
    } else {
      setHighFail(roundLevel)
      if (roundLevel - 1 <= lowPass) {
        settle(Math.max(1, lowPass), rounds)
        return
      }
      startNextRound(roundLevel - 1)
    }
  }

  function startNextRound(level) {
    setQuestions(null)
    setRoundLevel(level)
    setStage('roundBreak')
  }

  function buildComments(rounds, level) {
    if (!calibrating) {
      const round = rounds[0]
      return round.pass
        ? `Confirmed via knowledge check: scored ${round.score}/${round.total} at ${KNOWLEDGE_LEVEL_LABELS[round.level]}, meeting expectations for that level.`
        : `Confirmed via knowledge check: scored ${round.score}/${round.total} at ${KNOWLEDGE_LEVEL_LABELS[round.level]}, below expectations for that level — adjusted to ${KNOWLEDGE_LEVEL_LABELS[level]}.`
    }
    const path = rounds
      .map((r) => `${KNOWLEDGE_LEVEL_LABELS[r.level]} (${r.score}/${r.total}, ${r.pass ? 'passed' : 'below expectations'})`)
      .join(' → ')
    return `Calibrated via knowledge check — no self-assessment existed to pitch at, so this found the level from scratch: ${path}. Diagnosed at ${KNOWLEDGE_LEVEL_LABELS[level]}.`
  }

  // The result becomes the skill's knowledge level as soon as it's known --
  // closing the result any other way must not drop the level.
  function settle(level, rounds) {
    setDiagnosedLevel(level)
    setStage('result')
    saveLevel(level, rounds)
  }

  async function saveLevel(level, rounds) {
    setError(null)
    setSaving(true)
    try {
      const { error: assessError } = await supabase.from('skill_assessments').insert({
        skill_id: skill.id,
        user_id: user.id,
        level,
        axis: 'knowledge',
        source: 'diagnostic_confirmed',
        comments: buildComments(rounds, level),
      })
      if (assessError) throw assessError

      // Only resolve the confirming_baseline sub-stage back to identified when
      // that's genuinely where the skill still is.
      const skillUpdate = { knowledge_level: level }
      if (skill.lifecycle_stage === 'confirming_baseline') skillUpdate.lifecycle_stage = 'identified'
      const { error: skillError } = await supabase.from('skills').update(skillUpdate).eq('id', skill.id)
      if (skillError) throw skillError

      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function requestClose() {
    if (saved) {
      onConfirmed()
      return
    }
    if (saving || savingRound) return
    if (confirmingLeave) {
      setConfirmingLeave(false)
      return
    }
    if (stage !== 'result' && answeredAny) {
      setConfirmingLeave(true)
      return
    }
    onClose()
  }

  const title = calibrating ? t('modals.confirmingBaselineQuiz.titleCalibrating') : t('modals.confirmingBaselineQuiz.titleConfirming')
  const subtitle =
    stage === 'result'
      ? t('modals.confirmingBaselineQuiz.subtitleSettled', { level: KNOWLEDGE_LEVEL_LABELS[diagnosedLevel] })
      : t('modals.confirmingBaselineQuiz.subtitleChecking', { level: KNOWLEDGE_LEVEL_LABELS[roundLevel] })

  return (
    <AccessibleDialog
      labelledBy="knowledge-quiz-dialog-title"
      onClose={requestClose}
      panelClassName="relative w-full max-w-xl bg-card border border-hairline rounded-2xl shadow-xl max-h-[90vh] flex flex-col overflow-hidden"
    >
      <div className="interview-hero flex items-center gap-3 border-b border-hairline px-5 py-4">
        <span
          aria-hidden="true"
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate text-lg text-paper shadow-sm ${
            loading ? 'interview-avatar-breathe' : ''
          }`}
        >
          ✓
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="knowledge-quiz-dialog-title" className="font-display text-xl leading-tight text-ink">
            {title}
          </h2>
          <p className="text-sm leading-snug text-secondary sm:truncate">
            {skill.name} · {subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('modals.confirmingBaselineQuiz.close')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl leading-none text-secondary hover:bg-paper hover:text-ink"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {stage === 'question' && questions && (
        <Progress
          total={questions.length}
          index={index}
          results={questions.map((q) => results[q.id])}
          label={t('modals.confirmingBaselineQuiz.questionCounter', { current: index + 1, total: questions.length })}
          roundLabel={calibrating ? t('modals.confirmingBaselineQuiz.roundLabel', { round: roundHistory.length + 1, level: KNOWLEDGE_LEVEL_LABELS[roundLevel] }) : null}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {(stage === 'intro' || stage === 'roundBreak') && (
          <div className="px-6 py-6">
            {stage === 'intro' ? (
              <div className="interview-bubble-in">
                <p className="font-display text-2xl text-ink">
                  {t('modals.confirmingBaselineQuiz.introHeading', { skill: skill.name })}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {calibrating
                    ? t('modals.confirmingBaselineQuiz.introLeadCalibrate')
                    : t('modals.confirmingBaselineQuiz.introLeadConfirm', { level: KNOWLEDGE_LEVEL_LABELS[startLevel] })}
                </p>
                <ul className="mt-5 grid gap-2 sm:grid-cols-3">
                  <Fact icon="📝" text={t('modals.confirmingBaselineQuiz.factQuestions', { count: questions?.length ?? 10 })} />
                  <Fact icon="🎯" text={t('modals.confirmingBaselineQuiz.factPass', { percent: Math.round(PASS_THRESHOLD * 100) })} />
                  <Fact icon="💡" text={t('modals.confirmingBaselineQuiz.factFeedback')} />
                </ul>
              </div>
            ) : (
              <RoundBreak t={t} lastRound={roundHistory[roundHistory.length - 1]} nextLevel={roundLevel} />
            )}

            {error && !questions ? (
              <p role="alert" className="mt-5 text-sm text-red-700">
                {error}
              </p>
            ) : (
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                {stage === 'intro' && (
                  <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-secondary hover:text-ink">
                    {t('modals.confirmingBaselineQuiz.notNow')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStage('question')}
                  disabled={loading || !questions}
                  autoFocus
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-moss px-5 py-2.5 font-medium text-paper shadow-sm transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-70 motion-reduce:transform-none"
                >
                  {loading ? (
                    <>
                      <TypingDots light />
                      <span key={loadingLine} className="interview-bubble-in">
                        {t(`modals.confirmingBaselineQuiz.${LOADING_LINES[loadingLine]}`)}
                      </span>
                    </>
                  ) : stage === 'intro' ? (
                    t('modals.confirmingBaselineQuiz.start')
                  ) : (
                    t('modals.confirmingBaselineQuiz.startNextRound')
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {stage === 'question' && question && (
          <div key={question.id} className="interview-bubble-in px-5 py-5 sm:px-6">
            <QuestionCard t={t} question={question} answer={answers[question.id]} result={result} onAnswer={(value) => setAnswers((prev) => ({ ...prev, [question.id]: value }))} />
          </div>
        )}

        {stage === 'result' && (
          <ResultView
            t={t}
            calibrating={calibrating}
            rounds={roundHistory}
            diagnosedLevel={diagnosedLevel}
            saved={saved}
          />
        )}
      </div>

      {stage === 'question' && question && (
        <div className="border-t border-hairline bg-card px-5 py-3">
          {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-secondary">{result ? '' : hintFor(t, question)}</p>
            {!result ? (
              <button
                type="button"
                onClick={checkAnswer}
                disabled={!answered}
                className="rounded-full bg-moss px-5 py-2.5 font-medium text-paper shadow-sm hover:opacity-95 disabled:opacity-40"
              >
                {t('modals.confirmingBaselineQuiz.check')}
              </button>
            ) : (
              <button
                type="button"
                onClick={nextQuestion}
                disabled={savingRound}
                autoFocus
                className="rounded-full bg-moss px-5 py-2.5 font-medium text-paper shadow-sm hover:opacity-95 disabled:opacity-60"
              >
                {savingRound
                  ? t('modals.confirmingBaselineQuiz.saving')
                  : index + 1 < questions.length
                    ? t('modals.confirmingBaselineQuiz.next')
                    : t('modals.confirmingBaselineQuiz.finish')}
              </button>
            )}
          </div>
        </div>
      )}

      {stage === 'result' && (
        <div className="border-t border-hairline bg-card px-5 py-4">
          {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
          <button
            type="button"
            onClick={saved ? onConfirmed : () => saveLevel(diagnosedLevel, roundHistory)}
            disabled={saving}
            className="w-full rounded-full bg-moss px-5 py-2.5 font-medium text-paper shadow-sm hover:opacity-95 disabled:opacity-60"
          >
            {saving
              ? t('modals.confirmingBaselineQuiz.saving')
              : saved
                ? t('modals.confirmingBaselineQuiz.continue')
                : t('modals.confirmingBaselineQuiz.tryAgain')}
          </button>
        </div>
      )}

      {confirmingLeave && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-card/90 p-6 backdrop-blur-sm">
          <div
            role="alertdialog"
            aria-labelledby="quiz-leave-title"
            aria-describedby="quiz-leave-body"
            className="interview-bubble-in w-full max-w-xs rounded-2xl border border-hairline bg-card p-5 text-center shadow-lg"
          >
            <p className="text-3xl" aria-hidden="true">👋</p>
            <p id="quiz-leave-title" className="mt-2 font-display text-lg text-ink">
              {t('modals.confirmingBaselineQuiz.leaveTitle')}
            </p>
            <p id="quiz-leave-body" className="mt-1 text-sm text-secondary">
              {t('modals.confirmingBaselineQuiz.leaveBody')}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmingLeave(false)}
                className="rounded-full bg-moss px-4 py-2 font-medium text-paper hover:opacity-95"
              >
                {t('modals.confirmingBaselineQuiz.keepGoing')}
              </button>
              <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-secondary hover:text-ink">
                {t('modals.confirmingBaselineQuiz.leave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AccessibleDialog>
  )
}

function initialAnswer(question) {
  if (question.layout === 'multiple') return []
  if (question.layout === 'matching') return {}
  if (question.layout === 'ordering') return startingOrder(question.items, question.id)
  return ''
}

function isAnswered(question, answer) {
  if (question.layout === 'matching') return question.items.every((item) => answer?.[item.id])
  if (question.layout === 'ordering') return true
  if (Array.isArray(answer)) return answer.length > 0
  return String(answer ?? '').trim() !== ''
}

function hintFor(t, question) {
  const key = {
    multiple: 'hintMultiple',
    ordering: 'hintOrdering',
    matching: 'hintMatching',
    short_text: 'hintShortText',
    number: 'hintNumber',
  }[question.layout]
  return key ? t(`modals.confirmingBaselineQuiz.${key}`) : t('modals.confirmingBaselineQuiz.hintSingle')
}

function TypingDots({ light = false }) {
  const colour = light ? 'bg-paper' : 'bg-moss'
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      <span className={`interview-typing-dot h-1.5 w-1.5 rounded-full ${colour}`} />
      <span className={`interview-typing-dot h-1.5 w-1.5 rounded-full ${colour}`} />
      <span className={`interview-typing-dot h-1.5 w-1.5 rounded-full ${colour}`} />
    </span>
  )
}

function Fact({ icon, text }) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-hairline bg-paper px-3 py-2.5 text-sm text-ink sm:flex-col sm:items-start sm:gap-1">
      <span aria-hidden="true" className="text-lg">
        {icon}
      </span>
      <span className="leading-snug">{text}</span>
    </li>
  )
}

function Progress({ total, index, results, label, roundLabel }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/60 px-5 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
        {roundLabel && <span className="mr-2 text-slate">{roundLabel}</span>}
        <span>{label}</span>
      </p>
      <div className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const r = results[i]
          const tone = r ? (r.correct ? 'bg-moss' : 'bg-red-700/70') : i === index ? 'bg-gold' : 'bg-hairline/50'
          return <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === index ? 'w-5' : 'w-2.5'} ${tone}`} />
        })}
      </div>
    </div>
  )
}

function RoundBreak({ t, lastRound, nextLevel }) {
  if (!lastRound) return null
  return (
    <div className="interview-bubble-in text-center">
      <p className="text-4xl" aria-hidden="true">
        {lastRound.pass ? '🚀' : '🧭'}
      </p>
      <p className="mt-2 font-display text-2xl text-ink">
        {lastRound.pass ? t('modals.confirmingBaselineQuiz.roundPassed') : t('modals.confirmingBaselineQuiz.roundNotYet')}
      </p>
      <p className="mt-2 text-sm text-secondary">
        {t('modals.confirmingBaselineQuiz.roundScore', {
          score: lastRound.score,
          total: lastRound.total,
          level: KNOWLEDGE_LEVEL_LABELS[lastRound.level],
        })}{' '}
        {lastRound.pass
          ? t('modals.confirmingBaselineQuiz.roundUp', { level: KNOWLEDGE_LEVEL_LABELS[nextLevel] })
          : t('modals.confirmingBaselineQuiz.roundDown', { level: KNOWLEDGE_LEVEL_LABELS[nextLevel] })}
      </p>
    </div>
  )
}

// One question, in whichever of the course builder's scored-question
// layouts it uses. Once checked, it shows what was right.
function QuestionCard({ t, question, answer, result, onAnswer }) {
  const checked = Boolean(result)
  const choice = ['single', 'multiple', 'true_false'].includes(question.layout)
  const matchOptions = useMemo(
    () => shuffleStable(question.items.map((item) => item.detail).filter(Boolean), question.id),
    [question]
  )
  const inputRef = useRef(null)

  function choose(id) {
    if (checked) return
    if (question.layout === 'multiple') onAnswer(answer.includes(id) ? answer.filter((v) => v !== id) : [...answer, id])
    else onAnswer(id)
  }

  function move(position, delta) {
    const next = [...answer]
    const target = position + delta
    if (target < 0 || target >= next.length) return
    ;[next[position], next[target]] = [next[target], next[position]]
    onAnswer(next)
  }

  const correctTexts = (() => {
    if (question.layout === 'short_text') return question.items.map((item) => item.label).filter(Boolean)[0]
    if (question.layout === 'number') return String(question.items[0]?.value ?? '')
    return null
  })()

  return (
    <fieldset>
      <legend className="font-display text-xl leading-snug text-ink">{question.title}</legend>

      {choice && (
        <div className="mt-4 space-y-2" role={question.layout === 'multiple' ? 'group' : 'radiogroup'}>
          {question.items.map((item, i) => {
            const selected = question.layout === 'multiple' ? answer.includes(item.id) : answer === item.id
            const state = checked
              ? item.correct ? (selected ? 'right' : 'missed') : selected ? 'wrong' : 'idle'
              : selected ? 'selected' : 'idle'
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition-colors ${
                  state === 'right'
                    ? 'border-moss bg-moss/10 text-ink'
                    : state === 'missed'
                      ? 'border-dashed border-moss bg-paper text-ink'
                    : state === 'wrong'
                      ? 'border-red-700 bg-red-700/10 text-ink'
                      : state === 'selected'
                        ? 'border-slate bg-slate/10 text-ink'
                        : 'border-hairline bg-paper text-ink hover:border-slate'
                } ${checked ? 'cursor-default' : ''}`}
              >
                <input
                  type={question.layout === 'multiple' ? 'checkbox' : 'radio'}
                  name={`quiz-${question.id}`}
                  checked={selected}
                  disabled={checked}
                  onChange={() => choose(item.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                    state === 'right'
                      ? 'border-moss bg-moss text-paper'
                      : state === 'missed'
                        ? 'border-moss text-moss'
                      : state === 'wrong'
                        ? 'border-red-700 bg-red-700 text-paper'
                        : state === 'selected'
                          ? 'border-slate bg-slate text-paper'
                          : 'border-hairline text-secondary'
                  }`}
                >
                  {state === 'right' || state === 'missed' ? '✓' : state === 'wrong' ? '✕' : String.fromCharCode(65 + i)}
                </span>
                <span className="leading-snug">{item.label}</span>
                {(state === 'right' || state === 'missed') && (
                  <span className="sr-only"> ({t('modals.confirmingBaselineQuiz.srRightAnswer')})</span>
                )}
                {state === 'wrong' && <span className="sr-only"> ({t('modals.confirmingBaselineQuiz.srWrongAnswer')})</span>}
              </label>
            )
          })}
        </div>
      )}

      {(question.layout === 'short_text' || question.layout === 'number') && (
        <div className="mt-4">
          <label htmlFor={`quiz-answer-${question.id}`} className="sr-only">
            {t('modals.confirmingBaselineQuiz.yourAnswer')}
          </label>
          <input
            id={`quiz-answer-${question.id}`}
            ref={inputRef}
            type={question.layout === 'number' ? 'number' : 'text'}
            step="any"
            autoFocus
            value={answer}
            disabled={checked}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder={t('modals.confirmingBaselineQuiz.yourAnswer')}
            className={`w-full rounded-xl border bg-paper px-4 py-3 text-ink focus:outline-none focus:ring-2 focus:ring-moss ${
              checked ? (result.correct ? 'border-moss' : 'border-red-700') : 'border-hairline'
            }`}
          />
        </div>
      )}

      {question.layout === 'ordering' && (
        <ol className="mt-4 space-y-2">
          {answer.map((id, position) => {
            const item = question.items.find((candidate) => candidate.id === id)
            const inPlace = checked && question.items[position]?.id === id
            return (
              <li
                key={id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                  checked ? (inPlace ? 'border-moss bg-moss/10' : 'border-red-700 bg-red-700/10') : 'border-hairline bg-paper'
                }`}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-hairline text-xs font-semibold text-secondary">
                  {position + 1}
                </span>
                <span className="flex-1 leading-snug text-ink">{item?.label}</span>
                {!checked && (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => move(position, -1)}
                      disabled={position === 0}
                      aria-label={t('modals.confirmingBaselineQuiz.moveUp', { item: item?.label })}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-hairline text-ink hover:bg-card disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(position, 1)}
                      disabled={position === answer.length - 1}
                      aria-label={t('modals.confirmingBaselineQuiz.moveDown', { item: item?.label })}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-hairline text-ink hover:bg-card disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {question.layout === 'matching' && (
        <div className="mt-4 space-y-2">
          {question.items.map((item) => {
            const right = checked && answer?.[item.id] === item.detail
            return (
              <label
                key={item.id}
                className={`flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-sm sm:flex-row sm:items-center ${
                  checked ? (right ? 'border-moss bg-moss/10' : 'border-red-700 bg-red-700/10') : 'border-hairline bg-paper'
                }`}
              >
                <span className="flex-1 leading-snug text-ink">{item.label}</span>
                <select
                  value={answer?.[item.id] ?? ''}
                  disabled={checked}
                  onChange={(e) => onAnswer({ ...answer, [item.id]: e.target.value })}
                  className="rounded-lg border border-hairline bg-card px-2.5 py-2 text-ink sm:w-1/2"
                >
                  <option value="">{t('modals.confirmingBaselineQuiz.chooseMatch')}</option>
                  {matchOptions.map((match) => (
                    <option key={match} value={match}>
                      {match}
                    </option>
                  ))}
                </select>
                {checked && !right && (
                  <span className="text-xs text-secondary">
                    {t('modals.confirmingBaselineQuiz.correctAnswer', { answer: item.detail })}
                  </span>
                )}
              </label>
            )
          })}
        </div>
      )}

      {checked && (
        <div
          role="status"
          className={`interview-bubble-in mt-4 rounded-xl border px-4 py-3 text-sm ${
            result.correct ? 'border-moss/60 bg-moss/10' : 'border-gold/60 bg-gold/10'
          }`}
        >
          <p className="font-medium text-ink">
            {result.correct ? t('modals.confirmingBaselineQuiz.feedbackRight') : t('modals.confirmingBaselineQuiz.feedbackWrong')}
          </p>
          {!result.correct && correctTexts && (
            <p className="mt-0.5 text-secondary">{t('modals.confirmingBaselineQuiz.correctAnswer', { answer: correctTexts })}</p>
          )}
          {question.caption && <p className="mt-1 leading-relaxed text-secondary">{question.caption}</p>}
        </div>
      )}
    </fieldset>
  )
}

// Same mixed order every time for a question, so options don't jump about.
function shuffleStable(values, seed) {
  let hash = 0
  for (const character of String(seed)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    hash = (hash * 1103515245 + 12345) >>> 0
    const j = hash % (i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function ResultView({ t, calibrating, rounds, diagnosedLevel, saved }) {
  const lastRound = rounds[rounds.length - 1]
  const celebrate = calibrating || rounds[0]?.pass
  const headline = calibrating
    ? t('modals.confirmingBaselineQuiz.resultCalibrated')
    : rounds[0]?.pass
      ? t('modals.confirmingBaselineQuiz.resultPassed')
      : t('modals.confirmingBaselineQuiz.resultLanded')

  return (
    <div className="px-6 py-6">
      <div className="flex flex-col items-center text-center">
        <div className="relative grid place-items-center">
          {celebrate &&
            SPARKLES.map((s, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="interview-sparkle"
                style={{ '--dx': s.dx, '--dy': s.dy, background: s.color, animationDelay: `${0.25 + i * 0.04}s` }}
              />
            ))}
          <div className="interview-pop">
            <GrowthRing level={diagnosedLevel} size={104} labels={KNOWLEDGE_LEVEL_LABELS} color="var(--color-slate)" />
          </div>
        </div>
        <p className="interview-bubble-in mt-3 font-display text-2xl text-ink">
          {headline}
          {celebrate && <span aria-hidden="true"> 🎉</span>}
        </p>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-secondary">
          {calibrating ? t('modals.confirmingBaselineQuiz.diagnosedKnowledgeLevel') : t('modals.confirmingBaselineQuiz.confirmedKnowledgeLevel')}
        </p>
        <p className="text-lg font-medium text-ink">{KNOWLEDGE_LEVEL_LABELS[diagnosedLevel]}</p>
      </div>

      <div className="mt-5 rounded-xl border border-hairline bg-paper p-4 text-sm leading-relaxed text-ink">
        {calibrating ? (
          <>
            <p>
              {rounds.length === 1
                ? t('modals.confirmingBaselineQuiz.calibratingResultSingular', { levels: rounds.map((r) => KNOWLEDGE_LEVEL_LABELS[r.level]).join(' → ') })
                : t('modals.confirmingBaselineQuiz.calibratingResultPlural', {
                    count: rounds.length,
                    levels: rounds.map((r) => KNOWLEDGE_LEVEL_LABELS[r.level]).join(' → '),
                  })}
            </p>
            <ul className="mt-3 space-y-1.5">
              {rounds.map((round, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-ink">{KNOWLEDGE_LEVEL_LABELS[round.level]}</span>
                  <span className={round.pass ? 'text-moss' : 'text-secondary'}>
                    {round.score}/{round.total} {round.pass ? '✓' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : lastRound?.pass ? (
          t('modals.confirmingBaselineQuiz.confirmingResultPass', {
            score: lastRound.score,
            total: lastRound.total,
            level: KNOWLEDGE_LEVEL_LABELS[lastRound.level],
          })
        ) : (
          t('modals.confirmingBaselineQuiz.confirmingResultFail', {
            score: lastRound?.score,
            total: lastRound?.total,
            level: KNOWLEDGE_LEVEL_LABELS[lastRound?.level],
            adjustedLevel: KNOWLEDGE_LEVEL_LABELS[diagnosedLevel],
          })
        )}
      </div>

      {saved && (
        <p role="status" className="mt-3 text-center text-sm text-moss">
          {t('modals.confirmingBaselineQuiz.savedToSkill')}
        </p>
      )}
    </div>
  )
}
