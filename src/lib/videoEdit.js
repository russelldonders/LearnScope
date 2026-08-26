import { useRef } from 'react'

// Shared shape + helpers for a video resource's non-destructive edit
// (content_resources.video_edit, 0087) -- trim points, a CSS-filter-style
// color adjustment, playback speed, and a list of timed/positioned text or
// sticker overlays. Read by EditedVideoPlayer.jsx (playback, everywhere a
// course video renders) and written by VideoEditorModal.jsx (the editor
// itself) so both stay in sync on exactly what the stored shape means.

export const OVERLAY_SIZE_PX = { small: 16, medium: 24, large: 36 }

export const STICKER_EMOJI = [
  '👍', '❤️', '⭐', '✅', '⚠️', '💡', '🎯', '🔥',
  '👏', '🙌', '📌', '❓', '❗', '🎉', '🚀', '💪',
  '🧠', '📈', '🔒', '🔑', '⏱️', '📝', '🏆', '👀',
]

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

export function defaultFilter() {
  return { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0 }
}

// Tolerates a resource with no edit yet (video_edit is null) -- every
// reader goes through this rather than repeating its own defaults.
// `duration`, when known, resolves an unset trimEnd to "the whole video"
// instead of leaving it null.
export function normalizeVideoEdit(videoEdit, duration = null) {
  const v = videoEdit || {}
  return {
    trimStart: v.trimStart ?? 0,
    trimEnd: v.trimEnd ?? duration ?? null,
    playbackRate: v.playbackRate ?? 1,
    filter: { ...defaultFilter(), ...(v.filter ?? {}) },
    overlays: Array.isArray(v.overlays) ? v.overlays : [],
  }
}

export function buildFilterCss(filter) {
  const f = { ...defaultFilter(), ...(filter ?? {}) }
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%)`
}

export function createTextOverlay(duration) {
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    content: 'Add text',
    x: 50,
    y: 50,
    color: '#ffffff',
    size: 'medium',
    startTime: 0,
    endTime: duration || 0,
  }
}

export function createIconOverlay(emoji, duration) {
  return {
    id: crypto.randomUUID(),
    kind: 'icon',
    content: emoji,
    x: 50,
    y: 50,
    size: 'large',
    startTime: 0,
    endTime: duration || 0,
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// m:ss.s, for the timeline slider's handle labels -- read-only display, so
// unlike the number inputs it replaced there's no controlled-input/cursor
// fight to worry about.
export function formatTime(seconds) {
  const s = Math.max(0, seconds || 0)
  const m = Math.floor(s / 60)
  const rem = (s % 60).toFixed(1).padStart(4, '0')
  return `${m}:${rem}`
}

// Applies trimStart/trimEnd to a <video>'s actual playback -- shared by
// EditedVideoPlayer (real playback, reads a saved edit) and
// VideoEditorModal's own preview (reads the in-progress, unsaved edit), so
// "what trim looks like" can't drift between editing and the real thing.
// `onEnded` fires once when playback reaches trimEnd, mirroring native
// <video> onEnded firing once per run-off-the-end rather than once per
// element lifetime (re-armed on seeking back before trimEnd).
export function useTrimPlayback(edit, onEnded) {
  const endedFiredRef = useRef(false)

  function handleLoadedMetadata(e) {
    e.currentTarget.playbackRate = edit.playbackRate
    if (edit.trimStart > 0) e.currentTarget.currentTime = edit.trimStart
  }

  function handleTimeUpdate(e) {
    if (edit.trimEnd != null && e.currentTarget.currentTime >= edit.trimEnd && !endedFiredRef.current) {
      endedFiredRef.current = true
      e.currentTarget.pause()
      onEnded?.()
    }
  }

  function handleSeeking(e) {
    // Scrubbing before the trim start snaps forward to it -- trim is a
    // soft/non-destructive playback window (the underlying file is
    // untouched), but a viewer/editor dragging the native seek bar
    // shouldn't be able to land in the pre-trim portion any more than they
    // could with a truly trimmed file.
    if (e.currentTarget.currentTime < edit.trimStart) {
      e.currentTarget.currentTime = edit.trimStart
      return
    }
    if (e.currentTarget.currentTime < (edit.trimEnd ?? Infinity)) endedFiredRef.current = false
  }

  function handleNativeEnded() {
    if (!endedFiredRef.current) {
      endedFiredRef.current = true
      onEnded?.()
    }
  }

  return { handleLoadedMetadata, handleTimeUpdate, handleSeeking, handleNativeEnded }
}
