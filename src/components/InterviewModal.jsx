import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GrowthRing from './GrowthRing'
import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { fetchOrGenerateInterviewPlan, sendInterviewTurn, saveInterviewAttempt } from '../lib/skillDiagnostics'
import AccessibleDialog from './AccessibleDialog'

const SpeechRecognitionAPI =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

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
export default function InterviewModal({
  skill,
  user,
  actor,
  latestKnowledgeAssessment,
  calibrating = false,
  onClose,
  onConfirmed,
}) {
  const calibratedLevel = calibrating ? null : (latestKnowledgeAssessment?.level ?? skill.knowledge_level ?? 1)

  const [diagnosticContentId, setDiagnosticContentId] = useState(null)
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [finished, setFinished] = useState(false)
  const [confirmedLevel, setConfirmedLevel] = useState(null)
  const [reasoning, setReasoning] = useState(null)
  const [saving, setSaving] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  const [listening, setListening] = useState(false)
  const transcriptEndRef = useRef(null)
  const recognitionRef = useRef(null)

  useEffect(() => {
    fetchOrGenerateInterviewPlan({ skill, level: calibratedLevel, calibrate: calibrating })
      .then(({ diagnosticContentId: id, content }) => {
        if (!content?.openingQuestion) throw new Error("Couldn't prepare an interview for this skill.")
        setDiagnosticContentId(id)
        setPlan(content)
        setTranscript([{ role: 'interviewer', text: content.openingQuestion }])
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript])

  useEffect(() => {
    if (!readAloud || transcript.length === 0) return
    const last = transcript[transcript.length - 1]
    if (last.role !== 'interviewer' || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(last.text))
  }, [transcript, readAloud])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
      recognitionRef.current?.stop()
    }
  }, [])

  function toggleListening() {
    if (!SpeechRecognitionAPI) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognitionAPI()
    recognition.lang = 'en-US'
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
      const apiTranscript = updated
        .slice(1)
        .map((t) => ({ role: t.role === 'learner' ? 'user' : 'assistant', content: t.text }))
      const result = await sendInterviewTurn({
        skillName: skill.name,
        level: calibratedLevel,
        calibrate: calibrating,
        plan,
        transcript: apiTranscript,
      })
      const closingText = result.message || (result.done ? "That's everything I need -- thanks." : '')
      if (closingText) setTranscript((t) => [...t, { role: 'interviewer', text: closingText }])
      if (result.done) {
        setConfirmedLevel(result.confirmedLevel)
        setReasoning(result.reasoning)
        setFinished(true)
      }
    } catch (err) {
      // Roll back the optimistic learner turn -- otherwise a retry appends a
      // second consecutive learner turn, which breaks the strict user/
      // assistant alternation the interview-turn API (and Anthropic's
      // Messages API underneath it) requires, making every further retry
      // fail the same way with no way out except abandoning the interview.
      setTranscript(previous)
      setInputValue(answer)
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      await saveInterviewAttempt({
        user,
        actor,
        skill,
        diagnosticContentId,
        calibratedLevel,
        confirmedLevel,
        transcript,
        reasoning,
      })

      const { error: assessError } = await supabase.from('skill_assessments').insert({
        skill_id: skill.id,
        user_id: user.id,
        level: confirmedLevel,
        axis: 'knowledge',
        source: 'diagnostic_confirmed',
        comments: calibrating
          ? `Calibrated via conversational interview -- no self-assessment existed to pitch at, so this found the level from scratch: ${reasoning}`
          : `Confirmed via conversational interview: ${reasoning}`,
      })
      if (assessError) throw assessError

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
    <AccessibleDialog
      labelledBy="interview-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] flex flex-col overflow-y-auto overscroll-contain"
    >
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 id="interview-dialog-title" className="font-display text-2xl text-ink">Interview me</h2>
            <p className="text-sm text-secondary">
              {skill.name} · {calibrating ? 'finding your level' : `pitched at ${KNOWLEDGE_LEVEL_LABELS[calibratedLevel]}`}
            </p>
          </div>
          {typeof window !== 'undefined' && window.speechSynthesis && (
            <button
              type="button"
              onClick={() => setReadAloud((v) => !v)}
              title={readAloud ? 'Stop reading questions aloud' : 'Read questions aloud'}
              className={`shrink-0 rounded-md border px-2 py-1 text-xs ${
                readAloud ? 'border-slate bg-slate/10 text-ink' : 'border-hairline text-secondary hover:text-ink'
              }`}
            >
              {readAloud ? '🔊 On' : '🔈 Off'}
            </button>
          )}
        </div>

        {loading && <p className="text-sm text-secondary mt-4">Preparing your interview…</p>}
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}

        {!loading && plan && (
          <>
            <div className="flex-1 overflow-y-auto my-4 space-y-3 min-h-[200px]">
              {transcript.map((turn, i) => (
                <div key={i} className={`flex ${turn.role === 'learner' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      turn.role === 'learner' ? 'bg-moss text-paper' : 'bg-paper border border-hairline text-ink'
                    }`}
                  >
                    {turn.text}
                  </div>
                </div>
              ))}
              {sending && <p className="text-xs text-secondary">Thinking…</p>}
              <div ref={transcriptEndRef} />
            </div>

            {!finished ? (
              <form onSubmit={handleSend} className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Type your answer…"
                    disabled={sending}
                    autoFocus
                    className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-moss disabled:opacity-60"
                  />
                  {SpeechRecognitionAPI && (
                    <button
                      type="button"
                      onClick={toggleListening}
                      disabled={sending}
                      title={listening ? 'Stop listening' : 'Speak your answer'}
                      className={`shrink-0 rounded-md border px-3 py-2 text-sm ${
                        listening ? 'border-red-700 bg-red-700/10 text-red-700' : 'border-hairline text-ink hover:bg-paper'
                      } disabled:opacity-60`}
                    >
                      {listening ? '● Listening…' : '🎤'}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={sending || !inputValue.trim()}
                    className="shrink-0 rounded-md bg-moss text-paper px-4 py-2 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    Send
                  </button>
                </div>
                <button type="button" onClick={onClose} className="text-xs text-secondary hover:text-ink underline">
                  Cancel
                </button>
              </form>
            ) : (
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
                <p className="text-sm text-ink mb-4">{reasoning}</p>

                {error && <p className="text-sm text-red-700 mb-2">{error}</p>}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={saving}
                    className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </>
        )}
    </AccessibleDialog>
  )
}
