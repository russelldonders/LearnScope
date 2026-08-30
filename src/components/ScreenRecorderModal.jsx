import { useEffect, useRef, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'

const MAX_RECORDING_SECONDS = 15 * 60

function supportedMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.424028,mp4a.40.2',
    'video/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function fileExtension(mimeType) {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function ScreenRecorderModal({ onClose, onRecorded }) {
  const [status, setStatus] = useState('ready')
  const [includeMicrophone, setIncludeMicrophone] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [recordedFile, setRecordedFile] = useState(null)
  const recorderRef = useRef(null)
  const streamsRef = useRef([])
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const audioContextRef = useRef(null)
  const previewRef = useRef(null)

  function stopTracks() {
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
    streamsRef.current = []
    if (audioContextRef.current) audioContextRef.current.close().catch(() => {})
    audioContextRef.current = null
  }

  function clearTimer() {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
  }

  function startTimer(recorder) {
    clearTimer()
    timerRef.current = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + 1
        if (next >= MAX_RECORDING_SECONDS && recorder.state !== 'inactive') recorder.stop()
        return Math.min(next, MAX_RECORDING_SECONDS)
      })
    }, 1000)
  }

  useEffect(() => {
    return () => {
      clearTimer()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      stopTracks()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function buildRecordingStream(displayStream, microphoneStream) {
    const videoTrack = displayStream.getVideoTracks()[0]
    const audioTracks = [...displayStream.getAudioTracks(), ...(microphoneStream?.getAudioTracks() ?? [])]
    if (audioTracks.length <= 1) return new MediaStream([videoTrack, ...audioTracks])

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return new MediaStream([videoTrack, ...audioTracks])

    const context = new AudioContextClass()
    const destination = context.createMediaStreamDestination()
    audioTracks.forEach((track) => context.createMediaStreamSource(new MediaStream([track])).connect(destination))
    audioContextRef.current = context
    return new MediaStream([videoTrack, ...destination.stream.getAudioTracks()])
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      setError('Screen recording is not supported in this browser. Try the latest Chrome, Edge, Firefox, or Safari.')
      return
    }

    setError(null)
    setStatus('requesting')
    chunksRef.current = []
    setElapsed(0)

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: true,
      })
      streamsRef.current = [displayStream]

      let microphoneStream = null
      if (includeMicrophone) {
        try {
          microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true })
          streamsRef.current.push(microphoneStream)
        } catch {
          displayStream.getTracks().forEach((track) => track.stop())
          streamsRef.current = []
          setStatus('ready')
          setError('Microphone access was not granted. Turn off microphone narration and try again, or allow access.')
          return
        }
      }

      const recordingStream = await buildRecordingStream(displayStream, microphoneStream)
      const mimeType = supportedMimeType()
      const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      })
      recorder.addEventListener('stop', () => {
        clearTimer()
        stopTracks()
        const finalMimeType = recorder.mimeType || mimeType || 'video/webm'
        const blob = new Blob(chunksRef.current, { type: finalMimeType })
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const file = new File([blob], `screen-recording-${timestamp}.${fileExtension(finalMimeType)}`, {
          type: finalMimeType,
        })
        const url = URL.createObjectURL(blob)
        setRecordedFile(file)
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current)
          return url
        })
        setStatus('preview')
      })
      recorder.addEventListener('error', () => {
        clearTimer()
        stopTracks()
        setStatus('ready')
        setError('The recording stopped unexpectedly. Please try again.')
      })

      displayStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop()
      })

      recorder.start(1000)
      setStatus('recording')
      startTimer(recorder)
    } catch (err) {
      stopTracks()
      setStatus('ready')
      if (err?.name === 'NotAllowedError') {
        setError('Screen sharing was cancelled or blocked. Choose a screen, window, or tab to start recording.')
      } else {
        setError(err?.message || 'Screen recording could not start. Please try again.')
      }
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state !== 'inactive') recorderRef.current.stop()
  }

  function togglePause() {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recorder.state === 'recording') {
      recorder.pause()
      clearTimer()
      setStatus('paused')
    } else if (recorder.state === 'paused') {
      recorder.resume()
      startTimer(recorder)
      setStatus('recording')
    }
  }

  function recordAgain() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setRecordedFile(null)
    setElapsed(0)
    setStatus('ready')
  }

  function useRecording() {
    if (!recordedFile) return
    onRecorded(recordedFile)
    onClose()
  }

  function close() {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      return
    }
    stopTracks()
    onClose()
  }

  const active = status === 'recording' || status === 'paused'

  return (
    <AccessibleDialog
      labelledBy="screen-recorder-title"
      describedBy="screen-recorder-description"
      onClose={close}
      closeOnBackdrop={!active}
      panelClassName="w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl bg-card border border-hairline shadow-xl p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 id="screen-recorder-title" className="font-display text-xl text-ink">Record your screen</h2>
          <p id="screen-recorder-description" className="text-sm text-secondary mt-1 max-w-xl">
            Choose a screen, window, or browser tab. You will review it before adding it as a screen recording resource.
          </p>
        </div>
        <button type="button" onClick={close} className="text-secondary hover:text-ink p-1" aria-label={active ? 'Stop recording' : 'Close screen recorder'}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2 mb-4">{error}</p>}

      {status === 'ready' || status === 'requesting' ? (
        <div className="rounded-lg bg-paper border border-hairline p-5 sm:p-6">
          <div className="flex gap-4 items-start">
            <span className="grid place-items-center w-10 h-10 rounded-full bg-moss/10 text-moss shrink-0" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="font-medium text-ink">Your browser will ask what to share</p>
              <p className="text-sm text-secondary mt-1">Notifications and anything visible in the selected area may appear in the recording. Close sensitive information first.</p>
            </div>
          </div>

          <label className="flex items-start gap-3 mt-5 text-sm text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={includeMicrophone}
              onChange={(event) => setIncludeMicrophone(event.target.checked)}
              className="mt-0.5 accent-moss"
            />
            <span>
              <span className="font-medium block">Include microphone narration</span>
              <span className="text-secondary">Your browser may separately request microphone access.</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              type="button"
              data-dialog-initial-focus
              onClick={startRecording}
              disabled={status === 'requesting'}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {status === 'requesting' ? 'Waiting for permission…' : 'Choose screen and record'}
            </button>
            <p className="text-xs text-secondary">Maximum recording length: 15 minutes</p>
          </div>
        </div>
      ) : active ? (
        <div className="rounded-lg bg-ink text-paper p-5 sm:p-6" aria-live="polite">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full bg-red-500 ${status === 'recording' ? 'animate-pulse' : ''}`} aria-hidden="true" />
              <div>
                <p className="font-medium">{status === 'paused' ? 'Recording paused' : 'Recording in progress'}</p>
                <p className="text-xs text-paper/70">Stop sharing from the browser at any time to finish.</p>
              </div>
            </div>
            <time className="font-mono text-2xl tabular-nums" dateTime={`PT${elapsed}S`}>{formatTime(elapsed)}</time>
          </div>
          <div className="flex flex-wrap gap-3 mt-6">
            <button type="button" onClick={togglePause} className="rounded-md border border-paper/40 py-2 px-4 text-sm font-medium hover:bg-paper/10">
              {status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={stopRecording} className="rounded-md bg-paper text-ink py-2 px-4 text-sm font-medium hover:opacity-90">
              Stop recording
            </button>
          </div>
        </div>
      ) : (
        <div>
          <video ref={previewRef} src={previewUrl} controls playsInline className="w-full aspect-video rounded-lg bg-black" />
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
            <div>
              <p className="font-medium text-ink">Recording ready</p>
              <p className="text-xs text-secondary mt-0.5">{formatTime(elapsed)} · Review it before adding it to your resource form.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={recordAgain} className="rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:border-moss">
                Record again
              </button>
              <button type="button" onClick={useRecording} className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90">
                Use recording
              </button>
            </div>
          </div>
        </div>
      )}
    </AccessibleDialog>
  )
}
