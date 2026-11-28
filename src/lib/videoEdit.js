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

// Quick-pick swatches for text overlay color/background -- the native
// <input type="color"> stays available for anything outside this set, but a
// one-tap preset row (the standard caption-tool pattern) is what most
// choices actually are in practice.
export const TEXT_COLOR_PRESETS = ['#ffffff', '#000000', '#fde047', '#f472b6', '#60a5fa', '#4ade80', '#fb923c']
export const TEXT_BACKGROUND_PRESETS = ['#000000', '#ffffff', '#111827', '#dc2626', '#2563eb', '#16a34a', '#f59e0b']

export function defaultFilter() {
  return { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hueRotate: 0 }
}

// One-tap looks, applied with the same CSS filter as the fine-tune sliders
// (nothing is re-encoded), so a preset is just a set of slider values.
export const FILTER_PRESETS = [
  { id: 'original', label: 'Original', filter: {} },
  { id: 'vivid', label: 'Vivid', filter: { saturate: 145, contrast: 110 } },
  { id: 'warm', label: 'Warm', filter: { sepia: 25, saturate: 125, brightness: 103 } },
  { id: 'cool', label: 'Cool', filter: { saturate: 90, brightness: 104, hueRotate: 12 } },
  { id: 'fade', label: 'Fade', filter: { contrast: 82, brightness: 110, saturate: 80 } },
  { id: 'vintage', label: 'Vintage', filter: { sepia: 55, contrast: 90, brightness: 105 } },
  { id: 'mono', label: 'Mono', filter: { grayscale: 100 } },
  { id: 'noir', label: 'Noir', filter: { grayscale: 100, contrast: 140, brightness: 95 } },
]

export function presetFilter(id) {
  const preset = FILTER_PRESETS.find((p) => p.id === id) ?? FILTER_PRESETS[0]
  return { ...defaultFilter(), ...preset.filter }
}

// The preset a filter matches exactly, or null once it's been fine-tuned.
export function presetIdFor(filter) {
  const current = { ...defaultFilter(), ...(filter ?? {}) }
  const match = FILTER_PRESETS.find((p) => {
    const values = presetFilter(p.id)
    return Object.keys(values).every((key) => values[key] === current[key])
  })
  return match?.id ?? null
}

// The preset after (step 1) or before (step -1) the current one, wrapping
// round -- what a sideways swipe on the preview moves to.
export function stepPreset(filter, step) {
  const index = FILTER_PRESETS.findIndex((p) => p.id === presetIdFor(filter))
  const from = index === -1 ? 0 : index
  return FILTER_PRESETS[(from + step + FILTER_PRESETS.length) % FILTER_PRESETS.length].id
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
    muted: v.muted === true,
    overlays: Array.isArray(v.overlays) ? v.overlays : [],
  }
}

export function buildFilterCss(filter) {
  const f = { ...defaultFilter(), ...(filter ?? {}) }
  return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) grayscale(${f.grayscale}%) sepia(${f.sepia}%) hue-rotate(${f.hueRotate}deg)`
}

export function createTextOverlay(duration) {
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    content: 'Add text',
    x: 50,
    y: 50,
    color: '#ffffff',
    // null == no pill, just the text-shadow'd caption style every overlay
    // already had. Set to a hex value for the Snapchat/IG-story "pill behind
    // the text" look.
    background: null,
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

// Overlays saved before they could be resized freely or turned have no
// scale or rotation; both default to "as placed".
export const OVERLAY_SCALE_MIN = 0.5
export const OVERLAY_SCALE_MAX = 4

export function overlayTransform(overlay) {
  const scale = overlay.scale ?? 1
  const rotation = overlay.rotation ?? 0
  return `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`
}

// Dragging close to the middle of the frame snaps onto it, the way story
// editors do, so a caption can be centred by eye. Returns the position and
// which guides to show.
export const SNAP_DISTANCE = 3

export function snapToCentre(x, y) {
  const snapX = Math.abs(x - 50) <= SNAP_DISTANCE
  const snapY = Math.abs(y - 50) <= SNAP_DISTANCE
  return { x: snapX ? 50 : x, y: snapY ? 50 : y, guides: { vertical: snapX, horizontal: snapY } }
}

// Two fingers on an overlay: how far apart they are and the angle between
// them, compared with where they started, give its new scale and rotation.
export function pinchTransform(start, now, startScale = 1, startRotation = 0) {
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
  const angle = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  const startDistance = distance(start[0], start[1])
  const scale = startDistance > 0 ? startScale * (distance(now[0], now[1]) / startDistance) : startScale
  const rotation = startRotation + angle(now[0], now[1]) - angle(start[0], start[1])
  return {
    scale: clamp(Math.round(scale * 100) / 100, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX),
    rotation: Math.round((((rotation % 360) + 540) % 360) - 180),
  }
}

// Moves a time range along the timeline without changing its length,
// keeping it inside the video.
export function shiftRange(start, end, delta, duration) {
  const length = end - start
  const nextStart = clamp(start + delta, 0, Math.max(0, duration - length))
  return { start: nextStart, end: nextStart + length }
}

// An edit worth saving: null when it's exactly the untouched video, so a
// recording added without changes stores no edit at all.
export function meaningfulEdit(edit, duration) {
  const sameTrim = edit.trimStart === 0 && (edit.trimEnd == null || duration == null || Math.abs(edit.trimEnd - duration) < 0.05)
  const same = sameTrim &&
    edit.playbackRate === 1 &&
    !edit.muted &&
    edit.overlays.length === 0 &&
    presetIdFor(edit.filter) === 'original'
  return same ? null : edit
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
