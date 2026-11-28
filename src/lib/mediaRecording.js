// Shared by the screen recorder and the camera recorder: which format this
// browser can record in, and turning the recorded chunks into a named file.

export function recordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.424028,mp4a.40.2',
    'video/mp4',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

export function recordingExtension(mimeType) {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

export function recordingFile(chunks, mimeType, namePrefix, now = new Date()) {
  const type = mimeType || 'video/webm'
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return new File([new Blob(chunks, { type })], `${namePrefix}-${timestamp}.${recordingExtension(type)}`, { type })
}

// m:ss for a recording timer.
export function formatRecordingTime(seconds) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

// A press on the shutter shorter than this is a tap (start, then tap again to
// stop); held longer, recording stops when it's let go.
export const HOLD_TO_RECORD_MS = 400

export const COUNTDOWN_OPTIONS = [0, 3, 10]
