import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import AccessibleDialog from './AccessibleDialog'
import VideoOverlayContent from './VideoOverlayContent'
import FilmstripTimeline from './videoEditor/FilmstripTimeline'
import TextEntryOverlay from './videoEditor/TextEntryOverlay'
import { contentFileUrl, updateVideoEdit } from '../lib/courseContent'
import {
  FILTER_PRESETS,
  OVERLAY_SCALE_MAX,
  OVERLAY_SCALE_MIN,
  PLAYBACK_RATES,
  STICKER_EMOJI,
  buildFilterCss,
  clamp,
  createIconOverlay,
  createTextOverlay,
  formatTime,
  meaningfulEdit,
  normalizeVideoEdit,
  overlayTransform,
  pinchTransform,
  presetFilter,
  presetIdFor,
  snapToCentre,
  stepPreset,
  useTrimPlayback,
} from '../lib/videoEdit'

const SWIPE_DISTANCE = 50
const TAP_DISTANCE = 6

function Icon({ children, size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const TOOLS = [
  { id: 'text', label: 'Text', icon: <span className="text-lg font-bold leading-none" aria-hidden="true">Aa</span> },
  { id: 'stickers', label: 'Stickers', icon: <Icon><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4 4 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" /></Icon> },
  { id: 'filters', label: 'Filters', icon: <Icon><circle cx="9" cy="9" r="5.5" /><circle cx="15" cy="15" r="5.5" /></Icon> },
  { id: 'speed', label: 'Speed', icon: <Icon><path d="M12 14l4-4" /><path d="M3.3 17a9 9 0 1 1 17.4 0" /></Icon> },
]

// Keeps the preview the video's own shape, as large as fits, so overlays
// placed on it land in the same spot during playback.
function useFitBox(areaRef, aspect) {
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return undefined
    function measure() {
      const style = window.getComputedStyle(area)
      const width = area.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0)
      const height = area.clientHeight - parseFloat(style.paddingTop || 0) - parseFloat(style.paddingBottom || 0)
      if (!width || !height) return
      const fitWidth = Math.min(width, height * aspect)
      setBox({ width: Math.floor(fitWidth), height: Math.floor(fitWidth / aspect) })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [areaRef, aspect])
  return box
}

// The current frame of the preview, drawn once -- the picture each filter
// tile shows itself on.
function FrameThumb({ videoRef, filter }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return
    canvas.width = 120
    canvas.height = Math.round((120 * video.videoHeight) / video.videoWidth)
    try {
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch {
      // Leaves the tile blank.
    }
  }, [videoRef])
  return <canvas ref={canvasRef} aria-hidden="true" className="h-full w-full bg-white/10 object-cover" style={{ filter: buildFilterCss(filter) }} />
}

// A full-screen, story-style editor for one video. Editing a saved resource
// (resource + onSaved) stores the edit on it (content_resources.video_edit,
// 0087); editing a fresh recording (file + onApply) hands the edit back so
// it can be saved with the upload. Either way nothing is burned into the
// video: trim, filter, speed, sound and overlays are applied at playback by
// EditedVideoPlayer.
export default function VideoEditorModal({ resource, file, title, onClose, onSaved, onApply, closeLabel = 'Close editor' }) {
  // Made and revoked together in one effect, so a remount (React's strict
  // mode does one) never keeps a URL that's already been revoked.
  const [fileUrl, setFileUrl] = useState(null)
  useEffect(() => {
    if (!file) return undefined
    const url = URL.createObjectURL(file)
    setFileUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const editingFile = Boolean(file)
  const src = editingFile ? fileUrl ?? undefined : contentFileUrl(resource)

  const initialEdit = useMemo(() => normalizeVideoEdit(resource?.video_edit ?? null), [resource?.video_edit])
  const [edit, setEdit] = useState(initialEdit)
  // The edit as it was when opened, with the video's length filled in once
  // it's known -- what "Edited" and Restore Original compare against.
  const [baseline, setBaseline] = useState(initialEdit)
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [duration, setDuration] = useState(null)
  const [aspect, setAspect] = useState(16 / 9)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [tool, setTool] = useState(null)
  const [fineTune, setFineTune] = useState(false)
  const [selectedOverlayId, setSelectedOverlayId] = useState(null)
  const [textEntry, setTextEntry] = useState(null) // { overlay, isNew }
  const [dragging, setDragging] = useState(false)
  const [overBin, setOverBin] = useState(false)
  const [guides, setGuides] = useState({ vertical: false, horizontal: false })
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const videoRef = useRef(null)
  const areaRef = useRef(null)
  const stageRef = useRef(null)
  const binRef = useRef(null)
  const editRef = useRef(edit)
  const gestureStartRef = useRef(null)
  const pointersRef = useRef(new Map())
  const overlayGestureRef = useRef(null)
  const swipeRef = useRef(null)
  const toastTimerRef = useRef(null)

  useEffect(() => {
    editRef.current = edit
  }, [edit])

  const box = useFitBox(areaRef, aspect)
  const selectedOverlay = edit.overlays.find((o) => o.id === selectedOverlayId) ?? null
  const trim = useTrimPlayback(edit)
  const dirty = JSON.stringify(edit) !== JSON.stringify(baseline)
  const activePreset = presetIdFor(edit.filter)

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = edit.muted
  }, [edit.muted])
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = edit.playbackRate
  }, [edit.playbackRate])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  function changeEdit(updater, { record = true } = {}) {
    setEdit((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      if (record && JSON.stringify(next) !== JSON.stringify(current)) {
        setPast((items) => [...items.slice(-49), current])
        setFuture([])
      }
      return next
    })
  }

  // A drag or pinch is one step in the undo history, however many moves it
  // took: the edit as it was when it began is recorded once it ends.
  function beginGesture() {
    if (!gestureStartRef.current) gestureStartRef.current = editRef.current
  }

  function endGesture() {
    const before = gestureStartRef.current
    gestureStartRef.current = null
    if (before && JSON.stringify(before) !== JSON.stringify(editRef.current)) {
      setPast((items) => [...items.slice(-49), before])
      setFuture([])
    }
  }

  function undo() {
    const previous = past.at(-1)
    if (!previous) return
    setFuture((items) => [edit, ...items].slice(0, 50))
    setEdit(previous)
    setPast((items) => items.slice(0, -1))
  }

  function redo() {
    const next = future[0]
    if (!next) return
    setPast((items) => [...items.slice(-49), edit])
    setEdit(next)
    setFuture((items) => items.slice(1))
  }

  function requestClose() {
    if (saving) return
    if (textEntry) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  function applyDuration(d) {
    setDuration(d)
    // Anything added before the length was known ran to 0; stretch it to
    // the whole video.
    const withLength = (prev) => ({
      ...prev,
      trimEnd: prev.trimEnd == null ? d : prev.trimEnd,
      overlays: prev.overlays.map((o) => (o.endTime === 0 ? { ...o, endTime: d } : o)),
    })
    changeEdit(withLength, { record: false })
    setBaseline(withLength)
  }

  function handleLoadedMetadata(e) {
    const video = e.currentTarget
    if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight)
    if (!Number.isFinite(video.duration)) {
      // A fresh WebM recording often reports no length until it's been
      // read to the end; seeking far ahead makes the browser work it out.
      const settle = () => {
        if (!Number.isFinite(video.duration)) return
        video.removeEventListener('durationchange', settle)
        video.currentTime = 0
        applyDuration(video.duration)
      }
      video.addEventListener('durationchange', settle)
      video.currentTime = 1e9
      return
    }
    applyDuration(video.duration)
    trim.handleLoadedMetadata(e)
  }

  function showToast(text) {
    setToast(text)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1200)
  }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      const end = edit.trimEnd ?? duration
      if (end != null && video.currentTime >= end - 0.05) video.currentTime = edit.trimStart
      const played = video.play()
      if (played?.catch) played.catch(() => {})
    } else {
      video.pause()
    }
  }

  function seek(time) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
    setCurrentTime(time)
  }

  function updateOverlay(id, patch, options) {
    changeEdit((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }), options)
  }

  function addOverlay(overlay) {
    changeEdit((prev) => ({ ...prev, overlays: [...prev.overlays, overlay] }))
    setSelectedOverlayId(overlay.id)
  }

  function removeOverlay(id) {
    changeEdit((prev) => ({ ...prev, overlays: prev.overlays.filter((o) => o.id !== id) }))
    setSelectedOverlayId((current) => (current === id ? null : current))
  }

  function applyPreset(id) {
    changeEdit((prev) => ({ ...prev, filter: presetFilter(id) }))
  }

  function chooseTool(id) {
    if (id === 'text') {
      videoRef.current?.pause()
      setTool(null)
      setTextEntry({
        overlay: { ...createTextOverlay(edit.trimEnd ?? duration), content: '', startTime: edit.trimStart },
        isNew: true,
      })
      return
    }
    setTool((current) => (current === id ? null : id))
    setFineTune(false)
  }

  function finishText(draft) {
    const { isNew } = textEntry
    setTextEntry(null)
    if (!draft.content.trim()) {
      if (!isNew) removeOverlay(draft.id)
      return
    }
    if (isNew) addOverlay(draft)
    else updateOverlay(draft.id, draft)
  }

  function editText(overlay) {
    videoRef.current?.pause()
    setTextEntry({ overlay, isNew: false })
  }

  // --- The preview itself: tap to play or pause, swipe sideways to change
  // filter.
  function handleStagePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return
    swipeRef.current = { x: e.clientX, y: e.clientY }
  }

  function handleStagePointerUp(e) {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const next = stepPreset(edit.filter, dx < 0 ? 1 : -1)
      applyPreset(next)
      showToast(FILTER_PRESETS.find((p) => p.id === next).label)
      return
    }
    if (Math.hypot(dx, dy) <= TAP_DISTANCE) {
      if (selectedOverlayId) setSelectedOverlayId(null)
      else togglePlay()
    }
  }

  // --- An overlay: drag to move (snapping to the centre), drag onto the bin
  // to delete, two fingers to resize and turn, tap a selected caption to
  // retype it.
  function handleOverlayPointerDown(e, overlay) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const pointers = pointersRef.current
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) {
      beginGesture()
      overlayGestureRef.current = {
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        // Where it was, so it moves with the finger from wherever it was
        // grabbed rather than jumping its centre under it.
        fromX: overlay.x,
        fromY: overlay.y,
        wasSelected: selectedOverlayId === overlay.id,
      }
      setSelectedOverlayId(overlay.id)
    } else if (pointers.size === 2 && overlayGestureRef.current) {
      overlayGestureRef.current.moved = true
      overlayGestureRef.current.pinch = {
        start: [...pointers.values()],
        scale: overlay.scale ?? 1,
        rotation: overlay.rotation ?? 0,
      }
    }
  }

  function handleOverlayPointerMove(e, overlay) {
    const pointers = pointersRef.current
    const gesture = overlayGestureRef.current
    if (!pointers.has(e.pointerId) || !gesture) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (gesture.pinch && pointers.size >= 2) {
      const now = [...pointers.values()].slice(0, 2)
      updateOverlay(overlay.id, pinchTransform(gesture.pinch.start, now, gesture.pinch.scale, gesture.pinch.rotation), { record: false })
      return
    }
    if (pointers.size !== 1 || gesture.pinch) return
    if (!gesture.moved && Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < TAP_DISTANCE) return
    gesture.moved = true
    setDragging(true)
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect?.width) return
    const snapped = snapToCentre(
      clamp(gesture.fromX + ((e.clientX - gesture.startX) / rect.width) * 100, 2, 98),
      clamp(gesture.fromY + ((e.clientY - gesture.startY) / rect.height) * 100, 2, 98),
    )
    setGuides(snapped.guides)
    const bin = binRef.current?.getBoundingClientRect()
    const onBin = Boolean(bin && e.clientX >= bin.left - 12 && e.clientX <= bin.right + 12 && e.clientY >= bin.top - 12 && e.clientY <= bin.bottom + 12)
    setOverBin(onBin)
    gesture.overBin = onBin
    updateOverlay(overlay.id, { x: snapped.x, y: snapped.y }, { record: false })
  }

  function handleOverlayPointerUp(e, overlay) {
    const pointers = pointersRef.current
    pointers.delete(e.pointerId)
    const gesture = overlayGestureRef.current
    if (gesture?.pinch && pointers.size < 2) gesture.pinch = null
    if (pointers.size > 0) return
    overlayGestureRef.current = null
    setDragging(false)
    setOverBin(false)
    setGuides({ vertical: false, horizontal: false })
    if (gesture?.moved && gesture.overBin) {
      // Dropped on the bin: one undo step brings it back where it was.
      const before = gestureStartRef.current ?? editRef.current
      gestureStartRef.current = null
      setPast((items) => [...items.slice(-49), before])
      setFuture([])
      setEdit((prev) => ({ ...prev, overlays: prev.overlays.filter((o) => o.id !== overlay.id) }))
      setSelectedOverlayId(null)
      return
    }
    endGesture()
    if (gesture && !gesture.moved && gesture.wasSelected && overlay.kind === 'text') editText(overlay)
  }

  function handleOverlayKeyDown(e, overlay) {
    const amount = e.shiftKey ? 5 : 1
    const scale = overlay.scale ?? 1
    const rotation = overlay.rotation ?? 0
    const patch = {
      ArrowLeft: { x: clamp(overlay.x - amount, 2, 98) },
      ArrowRight: { x: clamp(overlay.x + amount, 2, 98) },
      ArrowUp: { y: clamp(overlay.y - amount, 2, 98) },
      ArrowDown: { y: clamp(overlay.y + amount, 2, 98) },
      '+': { scale: clamp(scale + 0.1, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX) },
      '=': { scale: clamp(scale + 0.1, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX) },
      '-': { scale: clamp(scale - 0.1, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX) },
      '[': { rotation: rotation - 15 },
      ']': { rotation: rotation + 15 },
    }[e.key]
    if (patch) {
      e.preventDefault()
      updateOverlay(overlay.id, patch)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeOverlay(overlay.id)
    } else if (e.key === 'Enter' && overlay.kind === 'text') {
      e.preventDefault()
      editText(overlay)
    }
  }

  async function handleSave() {
    if (editingFile) {
      onApply?.(meaningfulEdit(edit, duration))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await updateVideoEdit(resource.id, edit)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const iconButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-90 disabled:opacity-30'
  const railButton = (active) => `${iconButton} backdrop-blur ${active ? 'bg-white text-black' : 'bg-black/45 hover:bg-white/15'}`
  const displayTitle = title ?? resource?.title
  const scaleBy = (overlay, step) => clamp((overlay.scale ?? 1) + step, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX)

  return (
    <AccessibleDialog
      labelledBy="video-editor-dialog-title"
      onClose={requestClose}
      closeOnBackdrop={false}
      overlayClassName="p-0!"
      panelClassName="relative flex h-full w-full flex-col overflow-hidden bg-black text-white focus:outline-none"
    >
      <header className="relative z-20 flex items-center gap-1 px-2 py-2 sm:gap-1.5 sm:px-4">
        <button type="button" onClick={requestClose} disabled={saving} aria-label={closeLabel} title={closeLabel} className={`${iconButton} hover:bg-white/10`}>
          <Icon size={20}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></Icon>
        </button>
        <div className="min-w-0 flex-1 px-1">
          <div className="flex items-center gap-2">
            <h2 id="video-editor-dialog-title" className="truncate text-base font-semibold">Edit Video</h2>
            {dirty && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">Edited</span>}
          </div>
          {displayTitle && <p className="truncate text-xs text-white/60">{displayTitle}</p>}
        </div>
        <button type="button" onClick={undo} disabled={!past.length || saving} aria-label="Undo" title="Undo" className={`${iconButton} hover:bg-white/10`}>
          <Icon size={19}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icon>
        </button>
        <button type="button" onClick={redo} disabled={!future.length || saving} aria-label="Redo" title="Redo" className={`${iconButton} hover:bg-white/10`}>
          <Icon size={19}><path d="M15 14 20 9l-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Icon>
        </button>
        {dirty && (
          <button type="button" onClick={() => changeEdit(baseline)} disabled={saving} aria-label="Restore Original" title="Restore original" className={`${iconButton} hover:bg-white/10`}>
            <Icon size={19}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || (!editingFile && !dirty)}
          className="ml-1 min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-black transition-transform hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          {saving ? 'Saving…' : editingFile ? 'Use video' : 'Done'}
        </button>
      </header>

      <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center py-1 pl-2 pr-16 sm:px-16">
        <div
          ref={stageRef}
          className="relative touch-none select-none overflow-hidden rounded-xl bg-black"
          style={{ width: box.width || '100%', height: box.height || '100%' }}
          onPointerDown={handleStagePointerDown}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={() => { swipeRef.current = null }}
        >
          {/* playsInline: otherwise mobile Safari plays it in its own
              fullscreen layer, where overlays can't be shown or dragged. */}
          <video
            ref={videoRef}
            src={src}
            playsInline
            preload="auto"
            aria-label="Video preview. Tap to play or pause, swipe sideways to change filter."
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={(e) => {
              trim.handleTimeUpdate(e)
              setCurrentTime(e.currentTarget.currentTime)
            }}
            onSeeking={trim.handleSeeking}
            onEnded={trim.handleNativeEnded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{ filter: buildFilterCss(edit.filter) }}
            className="block h-full w-full object-contain"
          />

          {guides.vertical && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-sky-300" aria-hidden="true" />}
          {guides.horizontal && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-sky-300" aria-hidden="true" />}

          {/* The layer lets taps through to the preview; each overlay opts
              back in so it can be dragged. */}
          <div className="pointer-events-none absolute inset-0">
            {edit.overlays.map((o) => {
              const inWindow = currentTime >= o.startTime && currentTime <= o.endTime
              const isSelected = selectedOverlayId === o.id
              // The selected one stays (dimmed) outside its time so it can
              // still be moved.
              if (!inWindow && !isSelected) return null
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${o.kind === 'text' ? 'Text' : 'Sticker'} overlay: ${o.content}. Arrow keys move it, plus and minus resize it, square brackets turn it${o.kind === 'text' ? ', Enter edits it' : ''}, Delete removes it.`}
                  onPointerDown={(e) => handleOverlayPointerDown(e, o)}
                  onPointerMove={(e) => handleOverlayPointerMove(e, o)}
                  onPointerUp={(e) => handleOverlayPointerUp(e, o)}
                  onPointerCancel={(e) => handleOverlayPointerUp(e, o)}
                  onDoubleClick={() => o.kind === 'text' && editText(o)}
                  onFocus={() => setSelectedOverlayId(o.id)}
                  onKeyDown={(e) => handleOverlayKeyDown(e, o)}
                  className={`pointer-events-auto absolute max-w-[85%] cursor-move touch-none rounded-lg px-1 text-center transition-opacity focus:outline-none ${
                    isSelected ? 'outline-2 outline-offset-4 outline-dashed outline-white/80' : ''
                  } ${!inWindow ? 'opacity-40' : ''} ${dragging && overBin && isSelected ? 'opacity-50' : ''}`}
                  style={{ left: `${o.x}%`, top: `${o.y}%`, transform: overlayTransform(o) }}
                >
                  <VideoOverlayContent overlay={o} />
                </div>
              )
            })}
          </div>

          {dragging && (
            <div
              ref={binRef}
              className={`pointer-events-none absolute bottom-4 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-2 transition-transform ${
                overBin ? 'scale-125 border-red-500 bg-red-500 text-white' : 'border-white/80 bg-black/50 text-white'
              }`}
              aria-hidden="true"
            >
              <Icon size={22}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Icon>
            </div>
          )}

          {!playing && !dragging && !selectedOverlayId && duration != null && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
              </span>
            </div>
          )}

          {toast && (
            <p className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-sm font-semibold" role="status">
              {toast}
            </p>
          )}
        </div>

        <nav className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2 sm:right-4" aria-label="Video editing tools">
          {TOOLS.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => chooseTool(id)}
              aria-pressed={id === 'text' ? undefined : tool === id}
              aria-label={id === 'text' ? 'Add Text' : label}
              title={label}
              className={railButton(tool === id)}
            >
              {icon}
            </button>
          ))}
          <button
            type="button"
            onClick={() => changeEdit((prev) => ({ ...prev, muted: !prev.muted }))}
            aria-pressed={edit.muted}
            aria-label="Mute"
            title={edit.muted ? 'Sound off' : 'Sound on'}
            className={railButton(edit.muted)}
          >
            <Icon>
              <path d="M11 5 6 9H3v6h3l5 4z" />
              {edit.muted
                ? <><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></>
                : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
            </Icon>
          </button>
        </nav>
      </div>

      <div className="relative z-20 space-y-2.5 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
        {tool === 'stickers' && (
          <section aria-label="Stickers" className="rounded-2xl bg-white/10 p-2.5">
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
              {STICKER_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    addOverlay(createIconOverlay(emoji, edit.trimEnd ?? duration))
                    setTool(null)
                  }}
                  className="flex aspect-square min-h-10 items-center justify-center rounded-xl text-2xl transition-transform hover:bg-white/10 active:scale-90"
                  aria-label={`Add ${emoji} sticker`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        )}

        {tool === 'filters' && (
          <section aria-label="Filters" className="space-y-2.5">
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter presets">
              {FILTER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  aria-pressed={activePreset === preset.id}
                  className="flex w-16 shrink-0 flex-col items-center gap-1 text-[11px] font-medium"
                >
                  <span className={`block h-16 w-16 overflow-hidden rounded-xl border-2 ${activePreset === preset.id ? 'border-white' : 'border-transparent'}`}>
                    <FrameThumb videoRef={videoRef} filter={presetFilter(preset.id)} />
                  </span>
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFineTune((open) => !open)}
              aria-expanded={fineTune}
              className="min-h-9 rounded-full bg-white/10 px-3.5 text-xs font-medium hover:bg-white/15"
            >
              Fine-tune
            </button>
            {fineTune && (
              <div className="grid gap-3 rounded-2xl bg-white/10 p-3 sm:grid-cols-3">
                {[
                  { key: 'brightness', label: 'Brightness' },
                  { key: 'contrast', label: 'Contrast' },
                  { key: 'saturate', label: 'Saturation' },
                ].map(({ key, label }) => (
                  <label key={key} className="block text-xs">
                    <span className="mb-1 flex justify-between"><span className="font-medium">{label}</span><span className="font-mono text-white/60">{edit.filter[key]}%</span></span>
                    <input
                      type="range"
                      min={50}
                      max={150}
                      value={edit.filter[key]}
                      onPointerDown={beginGesture}
                      onPointerUp={endGesture}
                      onChange={(e) => changeEdit((prev) => ({ ...prev, filter: { ...prev.filter, [key]: Number(e.target.value) } }), { record: !gestureStartRef.current })}
                      className="w-full accent-white"
                    />
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        {tool === 'speed' && (
          <section aria-label="Playback speed" className="flex flex-wrap items-center gap-1.5">
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => changeEdit((prev) => ({ ...prev, playbackRate: rate }))}
                aria-pressed={edit.playbackRate === rate}
                className={`min-h-10 rounded-full px-4 text-sm font-medium transition-transform active:scale-95 ${
                  edit.playbackRate === rate ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/15'
                }`}
              >
                {rate}×
              </button>
            ))}
          </section>
        )}

        {!tool && selectedOverlay && (
          <section aria-label={`Selected ${selectedOverlay.kind === 'text' ? 'text' : 'sticker'}`} className="flex flex-wrap items-center gap-1.5">
            {selectedOverlay.kind === 'text' && (
              <button type="button" onClick={() => editText(selectedOverlay)} className="min-h-10 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/15">
                Edit text
              </button>
            )}
            <button type="button" aria-label="Smaller" onClick={() => updateOverlay(selectedOverlay.id, { scale: scaleBy(selectedOverlay, -0.15) })} className={`${iconButton} bg-white/10 hover:bg-white/15`}>
              <Icon size={18}><line x1="5" y1="12" x2="19" y2="12" /></Icon>
            </button>
            <button type="button" aria-label="Bigger" onClick={() => updateOverlay(selectedOverlay.id, { scale: scaleBy(selectedOverlay, 0.15) })} className={`${iconButton} bg-white/10 hover:bg-white/15`}>
              <Icon size={18}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
            </button>
            <button type="button" aria-label="Turn left" onClick={() => updateOverlay(selectedOverlay.id, { rotation: (selectedOverlay.rotation ?? 0) - 15 })} className={`${iconButton} bg-white/10 hover:bg-white/15`}>
              <Icon size={18}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>
            </button>
            <button type="button" aria-label="Turn right" onClick={() => updateOverlay(selectedOverlay.id, { rotation: (selectedOverlay.rotation ?? 0) + 15 })} className={`${iconButton} bg-white/10 hover:bg-white/15`}>
              <Icon size={18}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Icon>
            </button>
            <button type="button" aria-label="Delete overlay" onClick={() => removeOverlay(selectedOverlay.id)} className={`${iconButton} bg-white/10 text-red-300 hover:bg-red-500/20`}>
              <Icon size={18}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Icon>
            </button>
            <p className="hidden text-xs text-white/60 sm:block">Drag to move · pinch to resize and turn · drag to the bin to delete</p>
          </section>
        )}

        <div className="flex items-center gap-3">
          <button type="button" onClick={togglePlay} disabled={!duration} aria-label={playing ? 'Pause' : 'Play'} className={`${iconButton} bg-white/10 hover:bg-white/15`}>
            {playing
              ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
          </button>
          <p className="font-mono text-xs tabular-nums text-white/70">
            {formatTime(currentTime)}{duration ? ` / ${formatTime(duration)}` : ''}
          </p>
          {error && <p className="ml-auto text-xs text-red-300" role="alert">Couldn’t save your edit. {error}</p>}
        </div>

        <FilmstripTimeline
          src={src}
          duration={duration}
          currentTime={currentTime}
          trimStart={edit.trimStart}
          trimEnd={edit.trimEnd}
          overlays={edit.overlays}
          selectedId={selectedOverlayId}
          onSeek={seek}
          onSelectOverlay={setSelectedOverlayId}
          onGestureStart={beginGesture}
          onGestureEnd={endGesture}
          onTrimChange={({ start, end }, record) => changeEdit((prev) => ({ ...prev, trimStart: start, trimEnd: end }), { record })}
          onOverlayTimeChange={(id, { start, end }, record) => updateOverlay(id, { startTime: start, endTime: end }, { record })}
        />

        {!editingFile && (
          <p className="text-[11px] text-white/50">Edits don’t change the uploaded file and apply everywhere this video is used.</p>
        )}
      </div>

      <p className="sr-only" aria-live="polite">{saving ? 'Saving video edit' : error ? 'Video edit could not be saved' : ''}</p>

      {textEntry && <TextEntryOverlay overlay={textEntry.overlay} onDone={finishText} />}

      {confirmDiscard && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" className="w-full max-w-sm rounded-2xl bg-card p-5 text-ink shadow-xl">
            <h3 id="discard-title" className="font-display text-lg text-ink">Discard Your Changes?</h3>
            <p className="mt-2 text-sm text-secondary">Your video has unsaved edits. You can keep editing, or discard them.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDiscard(false)} className="min-h-11 rounded-full border border-hairline px-4 text-sm font-medium text-ink transition-transform hover:bg-paper active:scale-95" autoFocus>
                Keep Editing
              </button>
              <button type="button" onClick={onClose} className="min-h-11 rounded-full bg-red-700 px-4 text-sm font-medium text-white transition-transform hover:opacity-90 active:scale-95">
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </AccessibleDialog>
  )
}
