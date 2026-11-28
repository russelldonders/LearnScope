import { useCallback, useEffect, useRef, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import VideoEditorModal from './VideoEditorModal'
import {
  COUNTDOWN_OPTIONS,
  HOLD_TO_RECORD_MS,
  formatRecordingTime,
  recordingFile,
  recordingMimeType,
} from '../lib/mediaRecording'

const MAX_RECORDING_SECONDS = 15 * 60

// A full-screen camera, the way story apps open one: the live picture fills
// the screen and one round shutter records -- tap to start and tap again to
// stop, or hold it and let go. A countdown can be set first, and the front
// and back cameras flipped between takes. What's filmed opens straight in the
// editor; onRecorded(file, { edit }) hands back the video and any edit.
export default function CameraRecorderModal({ onClose, onRecorded }) {
  const [status, setStatus] = useState('starting') // starting | ready | countdown | recording | editing | error
  const [facingMode, setFacingMode] = useState('user')
  const [microphone, setMicrophone] = useState(true)
  const [countdownSetting, setCountdownSetting] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [recordedFile, setRecordedFile] = useState(null)
  // Bumped to open the camera again: after an error, or to retake.
  const [cameraKey, setCameraKey] = useState(0)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const countdownRef = useRef(null)
  const pressRef = useRef(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const clearTimers = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    if (countdownRef.current) window.clearInterval(countdownRef.current)
    timerRef.current = null
    countdownRef.current = null
  }, [])

  // (Re)opens the camera whenever the chosen camera or the microphone setting
  // changes, or it's asked for again. It stays off while editing.
  useEffect(() => {
    let cancelled = false
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setError('Recording from a camera is not supported in this browser. Try the latest Chrome, Edge, Firefox, or Safari.')
        setStatus('error')
        return
      }
      stopStream()
      setStatus('starting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: microphone,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setError(null)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err?.name === 'NotAllowedError'
          ? 'Camera access was not allowed. Allow the camera in your browser settings, then try again.'
          : 'The camera could not start. Check that no other app is using it, then try again.')
        setStatus('error')
      }
    }
    open()
    return () => {
      cancelled = true
    }
  }, [facingMode, microphone, cameraKey, stopStream])

  useEffect(() => () => {
    clearTimers()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    stopStream()
  }, [clearTimers, stopStream])

  function startRecording() {
    const stream = streamRef.current
    if (!stream) return
    chunksRef.current = []
    const mimeType = recordingMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      clearTimers()
      setRecordedFile(recordingFile(chunksRef.current, recorder.mimeType || mimeType, 'camera-recording'))
      stopStream()
      setStatus('editing')
    })
    recorder.addEventListener('error', () => {
      clearTimers()
      setError('The recording stopped unexpectedly. Please try again.')
      setStatus('ready')
    })
    recorder.start(1000)
    setElapsed(0)
    setStatus('recording')
    timerRef.current = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + 1
        if (next >= MAX_RECORDING_SECONDS && recorder.state !== 'inactive') recorder.stop()
        return Math.min(next, MAX_RECORDING_SECONDS)
      })
    }, 1000)
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
  }

  function startCountdown() {
    setCountdown(countdownSetting)
    setStatus('countdown')
    countdownRef.current = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(countdownRef.current)
          countdownRef.current = null
          startRecording()
          return 0
        }
        return current - 1
      })
    }, 1000)
  }

  function cancelCountdown() {
    clearTimers()
    setCountdown(0)
    setStatus('ready')
  }

  // Tap or hold. A press that starts recording and lasts past the hold time
  // stops when it's let go; a shorter one leaves it recording until the next
  // tap. With a countdown, a tap starts (or cancels) the countdown instead.
  function handleShutterDown(event) {
    if (event.button !== undefined && event.button !== 0) return
    if (status === 'recording') {
      pressRef.current = null
      stopRecording()
      return
    }
    if (status === 'countdown') {
      pressRef.current = null
      cancelCountdown()
      return
    }
    if (status !== 'ready') return
    if (countdownSetting > 0) {
      pressRef.current = null
      startCountdown()
      return
    }
    pressRef.current = Date.now()
    startRecording()
  }

  function handleShutterUp() {
    const pressedAt = pressRef.current
    pressRef.current = null
    if (pressedAt && Date.now() - pressedAt >= HOLD_TO_RECORD_MS) stopRecording()
  }

  function handleShutterKey(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (event.repeat) return
    handleShutterDown({})
  }

  function close() {
    if (status === 'recording') {
      stopRecording()
      return
    }
    clearTimers()
    stopStream()
    onClose()
  }

  function retake() {
    setRecordedFile(null)
    setElapsed(0)
    setStatus('starting')
    setCameraKey((key) => key + 1)
  }

  if (status === 'editing' && recordedFile) {
    return (
      <VideoEditorModal
        file={recordedFile}
        title="Camera recording"
        onApply={(edit) => {
          onRecorded(recordedFile, { edit })
          onClose()
        }}
        onClose={retake}
        closeLabel="Retake"
      />
    )
  }

  const recording = status === 'recording'
  const busy = recording || status === 'countdown'
  const progress = (elapsed / MAX_RECORDING_SECONDS) * 100
  const shutterLabel = recording
    ? 'Stop recording'
    : status === 'countdown'
      ? 'Cancel countdown'
      : countdownSetting > 0
        ? `Start recording in ${countdownSetting} seconds`
        : 'Record video. Tap to start and stop, or hold to record.'

  return (
    <AccessibleDialog
      labelledBy="camera-recorder-title"
      onClose={close}
      closeOnBackdrop={false}
      overlayClassName="p-0!"
      panelClassName="relative h-full w-full overflow-hidden bg-black text-white"
    >
      <h2 id="camera-recorder-title" className="sr-only">Record with your camera</h2>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Camera preview"
        className="absolute inset-0 h-full w-full object-cover"
        // Mirrored like a mirror for the front camera; the recording itself
        // isn't, so text in the room reads the right way round.
        style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : undefined }}
      />

      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3 sm:p-4">
        <button
          type="button"
          onClick={close}
          aria-label={recording ? 'Stop and review' : 'Close camera'}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-transform active:scale-90"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>

        {busy ? (
          <p className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 font-mono text-sm tabular-nums" aria-live="polite">
            <span className={`h-2.5 w-2.5 rounded-full bg-red-500 ${recording ? 'animate-pulse' : ''}`} aria-hidden="true" />
            <time dateTime={`PT${elapsed}S`}>{formatRecordingTime(elapsed)}</time>
          </p>
        ) : <span />}

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setFacingMode((mode) => (mode === 'user' ? 'environment' : 'user'))}
            disabled={busy || status === 'starting'}
            aria-label={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-transform active:scale-90 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7h3l2-3h8l2 3h3v12H3z" /><path d="M9 13a3 3 0 0 0 5.2 2M15 11a3 3 0 0 0-5.2-2" /><path d="m14 15 .2 2.2M10 9l-.2-2.2" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setMicrophone((on) => !on)}
            disabled={busy}
            aria-pressed={microphone}
            aria-label="Record sound"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur transition-transform active:scale-90 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              {!microphone && <line x1="4" y1="4" x2="20" y2="20" />}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setCountdownSetting((current) => COUNTDOWN_OPTIONS[(COUNTDOWN_OPTIONS.indexOf(current) + 1) % COUNTDOWN_OPTIONS.length])}
            disabled={busy}
            aria-label={countdownSetting ? `Countdown: ${countdownSetting} seconds` : 'Countdown: off'}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-xs font-semibold backdrop-blur transition-transform active:scale-90 disabled:opacity-40"
          >
            {countdownSetting ? `${countdownSetting}s` : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {status === 'countdown' && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-display text-8xl font-semibold [text-shadow:0_2px_16px_rgba(0,0,0,0.6)]" aria-live="assertive">
          {countdown}
        </p>
      )}

      {status === 'starting' && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Starting camera…</p>
      )}

      {error && (
        <div className="absolute inset-x-4 top-20 mx-auto max-w-md rounded-xl bg-black/75 p-4 text-sm" role="alert">
          <p>{error}</p>
          {status === 'error' && (
            <button type="button" onClick={() => setCameraKey((key) => key + 1)} className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-medium text-black">
              Try again
            </button>
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/60 to-transparent pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
        <button
          type="button"
          data-dialog-initial-focus
          onPointerDown={handleShutterDown}
          onPointerUp={handleShutterUp}
          onPointerCancel={handleShutterUp}
          onKeyDown={handleShutterKey}
          disabled={status === 'starting' || status === 'error'}
          aria-label={shutterLabel}
          className="relative flex h-20 w-20 touch-none select-none items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40"
        >
          <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="40" cy="40" r="36" fill="none" stroke="white" strokeOpacity="0.9" strokeWidth="5" />
            {recording && (
              <circle cx="40" cy="40" r="36" fill="none" stroke="#ef4444" strokeWidth="5" strokeDasharray={`${(progress / 100) * 226} 226`} strokeLinecap="round" />
            )}
          </svg>
          <span className={`block bg-red-500 transition-all ${recording ? 'h-7 w-7 rounded-md' : 'h-14 w-14 rounded-full'}`} aria-hidden="true" />
        </button>
        <p className="text-xs text-white/80">
          {recording ? 'Tap to stop' : status === 'countdown' ? 'Tap to cancel' : 'Tap to record, or hold'}
        </p>
      </div>
    </AccessibleDialog>
  )
}
