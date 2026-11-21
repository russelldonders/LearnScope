import { useEffect, useRef, useState } from 'react'
import GrowthRing from './GrowthRing'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { saveInterview, sendInterviewAnswer, startInterview } from '../lib/skillDiagnostics'
import AccessibleDialog from './AccessibleDialog'
import { useLanguage } from '../context/LanguageContext'
import { pickVoice, readPreferredVoice, savePreferredVoice, speak, speechTag, voicesFor, watchVoices } from '../lib/speech'

const SpeechRecognitionAPI =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

// Mirrors MAX_LEARNER_TURNS in api/interview.js -- the server always wraps
// the interview up on the learner's sixth answer, so this is only used to
// show "Question n of up to 6"; it never decides when the interview ends.
const MAX_QUESTIONS = 6

const LOADING_LINES = ['loading1', 'loading2', 'loading3', 'loading4']
const THINKING_LINES = ['thinking1', 'thinking2', 'thinking3', 'thinking4']

const SPARKLES = [
  { dx: '-46px', dy: '-38px', color: 'var(--color-gold)' },
  { dx: '44px', dy: '-42px', color: 'var(--color-moss)' },
  { dx: '-54px', dy: '8px', color: 'var(--color-slate)' },
  { dx: '52px', dy: '12px', color: 'var(--color-gold)' },
  { dx: '-26px', dy: '46px', color: 'var(--color-moss)' },
  { dx: '30px', dy: '44px', color: 'var(--color-slate)' },
  { dx: '0px', dy: '-56px', color: 'var(--color-moss)' },
]

// A conversational alternative to ConfirmingBaselineQuizModal's multiple-
// choice quiz on the same knowledge-confirmation stage -- same calibrated
// level, same "diagnostic_confirmed" trust outcome, just gathered through a
// free-response back-and-forth instead of fixed questions. See
// skill_diagnostic_content's diagnostic_type check constraint (migration
// 0049), which reserved 'interview' alongside 'quiz' for exactly this.
//
// calibrating (from SkillDetail.jsx: no self-assessment and no prior
// confirmation exist to pitch at) switches this from "confirm the level I
// was pitched at" to "find the level from scratch" -- the model has no fixed
// ceiling and adapts within the single conversation instead, rather than the
// quiz's round-by-round bracket walk (a back-and-forth naturally reads its
// own difficulty as it goes, so one pass is enough here).
//
// The flow runs in three stages: an intro card (what to expect, so nobody is
// dropped cold into a question), the conversation itself, then a result
// reveal the learner chooses to save or discard -- nothing is recorded until
// they press save.
export default function InterviewModal({
  skill,
  latestKnowledgeAssessment,
  calibrating = false,
  onClose,
  onConfirmed,
}) {
  const { t, language } = useLanguage()
  const calibratedLevel = calibrating ? null : (latestKnowledgeAssessment?.level ?? skill.knowledge_level ?? 1)

  const [stage, setStage] = useState('intro') // intro -> chat -> result
  const [sessionId, setSessionId] = useState(null)
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingLine, setLoadingLine] = useState(0)
  const [error, setError] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [thinkingLine, setThinkingLine] = useState(0)
  const [finished, setFinished] = useState(false)
  const [confirmedLevel, setConfirmedLevel] = useState(null)
  const [reasoning, setReasoning] = useState(null)
  const [saving, setSaving] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  const [voices, setVoices] = useState([])
  const [voiceName, setVoiceName] = useState(() => readPreferredVoice())
  const [listening, setListening] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const transcriptEndRef = useRef(null)
  const recognitionRef = useRef(null)
  const inputRef = useRef(null)

  const canReadAloud = typeof window !== 'undefined' && Boolean(window.speechSynthesis)
  const voiceChoices = voicesFor(voices, language)
  const voice = pickVoice(voices, language, voiceName)

  useEffect(() => watchVoices(setVoices), [])
  const answersGiven = transcript.filter((turn) => turn.role === 'learner').length
  const currentQuestion = Math.min(MAX_QUESTIONS, answersGiven + 1)

  useEffect(() => {
    startInterview({ skill })
      .then(({ sessionId: id, openingQuestion, topics }) => {
        if (!id || !openingQuestion) throw new Error(t('modals.interview.couldntPrepareInterview'))
        setSessionId(id)
        setPlan({ topics: topics ?? [] })
        setTranscript([{ role: 'interviewer', text: openingQuestion }])
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads its inputs once when opened, by design
  }, [])

  // Rotating status lines while waiting -- a little reassurance that
  // something is happening, rather than one static "Loading…".
  useEffect(() => {
    if (!loading) return undefined
    const id = window.setInterval(() => setLoadingLine((n) => (n + 1) % LOADING_LINES.length), 1800)
    return () => window.clearInterval(id)
  }, [loading])

  useEffect(() => {
    if (!sending) return undefined
    setThinkingLine(Math.floor(Math.random() * THINKING_LINES.length))
    const id = window.setInterval(() => setThinkingLine((n) => (n + 1) % THINKING_LINES.length), 2200)
    return () => window.clearInterval(id)
  }, [sending])

  useEffect(() => {
    if (stage !== 'chat') return
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript, sending, stage])

  // Hand focus back to the answer box each time the interviewer replies.
  useEffect(() => {
    if (stage === 'chat' && !sending && !finished) inputRef.current?.focus()
  }, [stage, sending, finished])

  useEffect(() => {
    if (!readAloud || stage !== 'chat' || transcript.length === 0) return
    const last = transcript[transcript.length - 1]
    if (last.role !== 'interviewer' || !canReadAloud) return
    speak(last.text, { voice, language })
    // Only a new interviewer turn (or turning read-aloud on) speaks; changing
    // the voice applies from the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, readAloud, stage, canReadAloud])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
      recognitionRef.current?.stop()
    }
  }, [])

  // Escape, the backdrop and the close button all come through here: once
  // the learner has put some answers in, check before throwing them away.
  function requestClose() {
    if (saving) return
    // A second Escape while the "leave?" check is up backs out of the check
    // rather than out of the interview -- leaving takes the explicit button.
    if (confirmingLeave) {
      setConfirmingLeave(false)
      return
    }
    if (answersGiven > 0) {
      setConfirmingLeave(true)
      return
    }
    onClose()
  }

  function toggleListening() {
    if (!SpeechRecognitionAPI) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognitionAPI()
    recognition.lang = speechTag(language)
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? ''
      setInputValue((prev) => (prev ? `${prev} ${text}` : text))
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  function resizeInput(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(() => {
    resizeInput(inputRef.current)
  }, [inputValue])

  function handleInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend(e)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const answer = inputValue.trim()
    if (!answer || sending) return

    recognitionRef.current?.stop()

    const previous = transcript
    const updated = [...transcript, { role: 'learner', text: answer }]
    setTranscript(updated)
    setInputValue('')
    setSending(true)
    setError(null)

    try {
      // The server keeps the conversation; only the new answer is sent.
      const result = await sendInterviewAnswer({ sessionId, answer })
      const closingText = result.message || (result.done ? t('modals.interview.thatsEverythingINeed') : '')
      if (closingText) setTranscript((prev) => [...prev, { role: 'interviewer', text: closingText }])
      if (result.done) {
        setConfirmedLevel(result.confirmedLevel)
        setReasoning(result.reasoning)
        setFinished(true)
      }
    } catch (err) {
      // Roll back the optimistic learner turn (the server gives its copy
      // back too), so the same answer can simply be sent again.
      setTranscript(previous)
      setInputValue(answer)
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  // The server records the confirmed level from the conversation it had --
  // the browser only asks it to.
  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      await saveInterview({ sessionId })
      onConfirmed()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const subtitle = calibrating
    ? t('modals.interview.findingYourLevel')
    : t('modals.interview.pitchedAt', { level: KNOWLEDGE_LEVEL_LABELS[calibratedLevel] })

  return (
    <AccessibleDialog
      labelledBy="interview-dialog-title"
      onClose={requestClose}
      panelClassName="relative w-full max-w-xl bg-card border border-hairline rounded-2xl shadow-xl max-h-[90vh] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="interview-hero flex items-center gap-3 border-b border-hairline px-5 py-4">
        <InterviewerAvatar busy={loading || sending} />
        <div className="min-w-0 flex-1">
          <h2 id="interview-dialog-title" className="font-display text-xl leading-tight text-ink">
            {t('modals.interview.title')}
          </h2>
          <p className="text-sm leading-snug text-secondary sm:truncate">
            {skill.name} · {subtitle}
          </p>
        </div>
        {canReadAloud && stage !== 'result' && (
          <button
            type="button"
            onClick={() => setReadAloud((v) => !v)}
            aria-pressed={readAloud}
            title={readAloud ? t('modals.interview.stopReadingAloud') : t('modals.interview.readAloud')}
            aria-label={readAloud ? t('modals.interview.stopReadingAloud') : t('modals.interview.readAloud')}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-base transition-colors ${
              readAloud ? 'border-slate bg-slate/15 text-ink' : 'border-hairline text-secondary hover:text-ink'
            }`}
          >
            <span aria-hidden="true">{readAloud ? '🔊' : '🔈'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('modals.interview.close')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl leading-none text-secondary hover:bg-paper hover:text-ink"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {readAloud && stage !== 'result' && voiceChoices.length > 1 && (
        <div className="flex items-center gap-2 border-b border-hairline/60 px-5 py-2">
          <label htmlFor="interview-voice" className="text-xs text-secondary">{t('modals.interview.voice')}</label>
          <select
            id="interview-voice"
            value={voice?.name ?? ''}
            onChange={(event) => {
              setVoiceName(event.target.value)
              savePreferredVoice(event.target.value)
              const chosen = voiceChoices.find((option) => option.name === event.target.value)
              if (chosen) speak(t('modals.interview.voiceSample'), { voice: chosen, language })
            }}
            className="min-w-0 flex-1 rounded-md border border-hairline bg-paper px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-moss"
          >
            {voiceChoices.map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}
          </select>
        </div>
      )}

      {stage === 'chat' && !finished && (
        <QuestionProgress current={currentQuestion} label={t('modals.interview.questionProgress', { current: currentQuestion, max: MAX_QUESTIONS })} />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {stage === 'intro' && (
          <div className="px-6 py-6">
            {loading ? (
              <div className="flex flex-col items-center py-10 text-center" role="status">
                <TypingDots />
                <p key={loadingLine} className="interview-bubble-in mt-4 text-sm text-secondary">
                  {t(`modals.interview.${LOADING_LINES[loadingLine]}`, { skill: skill.name })}
                </p>
              </div>
            ) : error && !plan ? (
              <div className="py-6 text-center">
                <p className="text-3xl" aria-hidden="true">🫣</p>
                <p className="mt-2 text-sm text-red-700">{error}</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-4 rounded-full border border-hairline px-4 py-2 text-sm text-ink hover:bg-paper"
                >
                  {t('modals.interview.cancel')}
                </button>
              </div>
            ) : (
              <div className="interview-bubble-in">
                <p className="font-display text-2xl text-ink">
                  {t('modals.interview.introHeading', { skill: skill.name })}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {calibrating
                    ? t('modals.interview.introLeadCalibrate')
                    : t('modals.interview.introLeadConfirm', { level: KNOWLEDGE_LEVEL_LABELS[calibratedLevel] })}
                </p>

                <ul className="mt-5 grid gap-2 sm:grid-cols-3">
                  <IntroFact icon="⏱️" text={t('modals.interview.factTime')} />
                  <IntroFact icon="💬" text={t('modals.interview.factQuestions', { count: MAX_QUESTIONS })} />
                  <IntroFact icon="🤷" text={t('modals.interview.factHonest')} />
                </ul>

                {plan?.topics?.length > 0 && (
                  <div className="mt-5">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                      {t('modals.interview.mightCover')}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {plan.topics.map((topic) => (
                        <li
                          key={topic}
                          className="rounded-full border border-hairline bg-paper px-2.5 py-1 text-xs text-ink"
                        >
                          {topic}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full px-4 py-2 text-sm text-secondary hover:text-ink"
                  >
                    {t('modals.interview.notNow')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStage('chat')}
                    autoFocus
                    className="rounded-full bg-moss px-5 py-2.5 font-medium text-paper shadow-sm transition-transform hover:-translate-y-0.5 hover:opacity-95 motion-reduce:transform-none"
                  >
                    {t('modals.interview.start')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {stage === 'chat' && (
          <div className="min-h-[16rem] space-y-3 px-5 py-5" role="log" aria-live="polite" aria-label={t('modals.interview.conversation')}>
            {transcript.map((turn, i) => (
              <ChatBubble key={i} turn={turn} youLabel={t('modals.interview.you')} interviewerLabel={t('modals.interview.interviewer')} />
            ))}
            {sending && (
              <div className="interview-bubble-in flex items-end gap-2" role="status">
                <InterviewerAvatar small />
                <div className="flex items-center gap-3 rounded-2xl rounded-bl-md border border-hairline bg-paper px-4 py-3">
                  <TypingDots />
                  <span key={thinkingLine} className="interview-bubble-in text-xs text-secondary">
                    {t(`modals.interview.${THINKING_LINES[thinkingLine]}`)}
                  </span>
                </div>
              </div>
            )}
            {finished && (
              <div className="interview-bubble-in flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setStage('result')}
                  autoFocus
                  className="rounded-full bg-moss px-5 py-2.5 font-medium text-paper shadow-sm transition-transform hover:-translate-y-0.5 motion-reduce:transform-none"
                >
                  {t('modals.interview.seeResult')}
                </button>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}

        {stage === 'result' && (
          <ResultView
            t={t}
            calibrating={calibrating}
            calibratedLevel={calibratedLevel}
            confirmedLevel={confirmedLevel}
            reasoning={reasoning}
            transcript={transcript}
          />
        )}
      </div>

      {/* Footer: answer box during the chat, save/discard on the result. */}
      {stage === 'chat' && !finished && (
        <form onSubmit={handleSend} className="border-t border-hairline bg-card px-4 pb-3 pt-3">
          {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
          <div className="flex items-end gap-2 rounded-2xl border border-hairline bg-paper p-1.5 focus-within:ring-2 focus-within:ring-moss">
            <label htmlFor="interview-answer" className="sr-only">
              {t('modals.interview.typeYourAnswer')}
            </label>
            <textarea
              id="interview-answer"
              ref={inputRef}
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('modals.interview.typeYourAnswer')}
              disabled={sending}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-ink placeholder:text-secondary focus:outline-none disabled:opacity-60"
            />
            {SpeechRecognitionAPI && (
              <button
                type="button"
                onClick={toggleListening}
                disabled={sending}
                aria-pressed={listening}
                title={listening ? t('modals.interview.stopListening') : t('modals.interview.speakYourAnswer')}
                aria-label={listening ? t('modals.interview.stopListening') : t('modals.interview.speakYourAnswer')}
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base ${
                  listening ? 'animate-pulse bg-red-700/15 text-red-700 motion-reduce:animate-none' : 'text-secondary hover:bg-card hover:text-ink'
                } disabled:opacity-60`}
              >
                <span aria-hidden="true">🎤</span>
              </button>
            )}
            <button
              type="submit"
              disabled={sending || !inputValue.trim()}
              aria-label={t('modals.interview.send')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-moss text-paper transition-transform hover:scale-105 disabled:scale-100 disabled:opacity-40 motion-reduce:transform-none"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
          <p className="mt-1.5 hidden text-[11px] text-secondary sm:block">
            {listening ? t('modals.interview.listening') : t('modals.interview.enterHint')}
          </p>
          {listening && <p className="mt-1.5 text-[11px] text-red-700 sm:hidden">{t('modals.interview.listening')}</p>}
        </form>
      )}

      {stage === 'result' && (
        <div className="border-t border-hairline bg-card px-5 py-4">
          {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="rounded-full border border-hairline px-4 py-2 text-ink hover:bg-paper disabled:opacity-60"
            >
              {t('modals.interview.discard')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="rounded-full bg-moss px-5 py-2.5 font-medium text-paper shadow-sm hover:opacity-95 disabled:opacity-60"
            >
              {saving ? t('modals.interview.saving') : t('modals.interview.saveToSkill')}
            </button>
          </div>
        </div>
      )}

      {confirmingLeave && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-card/90 p-6 backdrop-blur-sm">
          <div
            role="alertdialog"
            aria-labelledby="interview-leave-title"
            aria-describedby="interview-leave-body"
            className="interview-bubble-in w-full max-w-xs rounded-2xl border border-hairline bg-card p-5 text-center shadow-lg"
          >
            <p className="text-3xl" aria-hidden="true">👋</p>
            <p id="interview-leave-title" className="mt-2 font-display text-lg text-ink">
              {t('modals.interview.leaveTitle')}
            </p>
            <p id="interview-leave-body" className="mt-1 text-sm text-secondary">
              {t('modals.interview.leaveBody')}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmingLeave(false)}
                className="rounded-full bg-moss px-4 py-2 font-medium text-paper hover:opacity-95"
              >
                {t('modals.interview.keepGoing')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-sm text-secondary hover:text-ink"
              >
                {t('modals.interview.leave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AccessibleDialog>
  )
}

function InterviewerAvatar({ busy = false, small = false }) {
  const size = small ? 'h-7 w-7 text-xs' : 'h-11 w-11 text-lg'
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-moss text-paper shadow-sm ${size} ${
        busy ? 'interview-avatar-breathe' : ''
      }`}
    >
      ✦
    </span>
  )
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      <span className="interview-typing-dot h-2 w-2 rounded-full bg-moss" />
      <span className="interview-typing-dot h-2 w-2 rounded-full bg-moss" />
      <span className="interview-typing-dot h-2 w-2 rounded-full bg-moss" />
    </span>
  )
}

function IntroFact({ icon, text }) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-hairline bg-paper px-3 py-2.5 text-sm text-ink sm:flex-col sm:items-start sm:gap-1">
      <span aria-hidden="true" className="text-lg">
        {icon}
      </span>
      <span className="leading-snug">{text}</span>
    </li>
  )
}

function QuestionProgress({ current, label }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/60 px-5 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{label}</p>
      <div className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: MAX_QUESTIONS }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i + 1 < current ? 'w-4 bg-moss' : i + 1 === current ? 'w-6 bg-gold' : 'w-1.5 bg-hairline/50'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

function ChatBubble({ turn, youLabel, interviewerLabel }) {
  const isLearner = turn.role === 'learner'
  return (
    <div className={`interview-bubble-in flex items-end gap-2 ${isLearner ? 'justify-end' : 'justify-start'}`}>
      {!isLearner && <InterviewerAvatar small />}
      <div
        className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isLearner
            ? 'rounded-br-md bg-moss text-paper'
            : 'rounded-bl-md border border-hairline bg-paper text-ink'
        }`}
      >
        <span className="sr-only">{isLearner ? youLabel : interviewerLabel}: </span>
        {turn.text}
      </div>
    </div>
  )
}

function ResultView({ t, calibrating, calibratedLevel, confirmedLevel, reasoning, transcript }) {
  const landedBelow = !calibrating && confirmedLevel < calibratedLevel
  const headline = landedBelow
    ? t('modals.interview.resultLanded')
    : calibrating
      ? t('modals.interview.resultCalibrated')
      : t('modals.interview.resultMet')

  return (
    <div className="px-6 py-6">
      <div className="flex flex-col items-center text-center">
        <div className="relative grid place-items-center">
          {!landedBelow &&
            SPARKLES.map((s, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="interview-sparkle"
                style={{ '--dx': s.dx, '--dy': s.dy, background: s.color, animationDelay: `${0.25 + i * 0.04}s` }}
              />
            ))}
          <div className="interview-pop">
            <GrowthRing level={confirmedLevel} size={104} labels={KNOWLEDGE_LEVEL_LABELS} color="var(--color-slate)" />
          </div>
        </div>
        <p className="interview-bubble-in mt-3 font-display text-2xl text-ink">
          {headline}
          {!landedBelow && <span aria-hidden="true"> 🎉</span>}
        </p>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-secondary">
          {t('modals.interview.confirmedKnowledgeLevel')}
        </p>
        <p className="text-lg font-medium text-ink">
          {KNOWLEDGE_LEVEL_LABELS[confirmedLevel]}{' '}
          <span className="text-sm font-normal text-secondary">
            · {t('modals.interview.resultLevelOf', { level: confirmedLevel })}
          </span>
        </p>
      </div>

      {reasoning && (
        <div className="mt-5 rounded-xl border border-hairline bg-paper p-4">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-secondary">
            <span aria-hidden="true" className="text-sm normal-case">✦</span>
            {t('modals.interview.whatINoticed')}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">{reasoning}</p>
        </div>
      )}

      {landedBelow && <p className="mt-3 text-sm text-secondary">{t('modals.interview.resultLowerNote')}</p>}

      <details className="group mt-4 rounded-xl border border-hairline/70">
        <summary className="cursor-pointer select-none rounded-xl px-4 py-2.5 text-sm text-secondary hover:text-ink">
          {t('modals.interview.reviewConversation')}
        </summary>
        <div className="space-y-2 px-4 pb-4 pt-1">
          {transcript.map((turn, i) => (
            <ChatBubble key={i} turn={turn} youLabel={t('modals.interview.you')} interviewerLabel={t('modals.interview.interviewer')} />
          ))}
        </div>
      </details>
    </div>
  )
}
