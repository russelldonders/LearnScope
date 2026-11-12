import { useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'

// The browser's speech-to-text, where it has one (Chrome, Edge, Safari).
function speechRecognitionClass() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

// The browser's own regional variant when it matches the app's language
// (so en-GB stays en-GB), otherwise the app's language.
function speechLanguage(language) {
  const browser = typeof navigator !== 'undefined' ? navigator.language : ''
  if (browser?.toLowerCase().startsWith(language)) return browser
  return language === 'zh' ? 'zh-CN' : language
}

// A "Speak" button that turns speech into text for a free-text box. What's
// said is added to whatever was already typed, never replacing it. Renders
// nothing where the browser has no speech-to-text. onError gets a message to
// show, or null when a new attempt starts; onListeningChange lets the form
// react while it listens.
export default function VoiceInputButton({ text, onText, onError, onListeningChange, disabled = false }) {
  const { t, language } = useLanguage()
  const SpeechRecognition = useMemo(speechRecognitionClass, [])
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef(null)

  useEffect(() => () => recognitionRef.current?.abort(), [])
  useEffect(() => {
    onListeningChange?.(listening)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reacts to listening changing
  }, [listening])

  if (!SpeechRecognition) return null

  function toggle() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = speechLanguage(language)
    recognition.interimResults = true
    recognition.continuous = false
    const typed = text.trim()
    recognition.onresult = (event) => {
      const spoken = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('')
        .trim()
      onText([typed, spoken].filter(Boolean).join(' '))
    }
    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      const blocked = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      onError(t(blocked ? 'quickLog.voice.blocked' : 'quickLog.voice.failed'))
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }
    recognitionRef.current = recognition
    onError(null)
    try {
      recognition.start()
      setListening(true)
    } catch {
      recognitionRef.current = null
      onError(t('quickLog.voice.failed'))
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-pressed={listening}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60 ${
        listening ? 'border-moss bg-moss/10 text-moss' : 'border-hairline bg-card text-ink hover:border-moss'
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      {listening ? t('quickLog.voice.stop') : t('quickLog.voice.start')}
    </button>
  )
}
