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
