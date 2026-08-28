import { useMemo, useRef, useState } from 'react'
import { contentFileUrl, updateVideoEdit } from '../lib/courseContent'
import AccessibleDialog from './AccessibleDialog'
import {
  OVERLAY_SIZE_PX,
  PLAYBACK_RATES,
  STICKER_EMOJI,
  buildFilterCss,
  clamp,
  createIconOverlay,
  createTextOverlay,
  formatTime,
  normalizeVideoEdit,
  useTrimPlayback,
} from '../lib/videoEdit'

const TABS = [
  { id: 'text', label: 'Text' },
  { id: 'icons', label: 'Icons' },
  { id: 'trim', label: 'Trim' },
  { id: 'adjust', label: 'Adjust' },
]

const SIZES = ['small', 'medium', 'large']

// A basic Instagram-style editor for one video resource: drag text/sticker
// overlays onto the preview, trim in/out points, and adjust color/speed --
// all stored as data (content_resources.video_edit) and applied at
// playback time by EditedVideoPlayer, never burned into the video itself.
// Editing here is org-library-scoped (see ResourceLibrarySection.jsx),
// since the resource is shared across every course it's linked into --
// one edit, applied everywhere the video plays, same "no duplication"
// rule as the resource itself.
export default function VideoEditorModal({ resource, onClose, onSaved }) {
  const initialEdit = useMemo(() => normalizeVideoEdit(resource.video_edit), [resource.video_edit])
  const [edit, setEdit] = useState(initialEdit)
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [duration, setDuration] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [tab, setTab] = useState('text')
  const [selectedOverlayId, setSelectedOverlayId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const videoRef = useRef(null)
  const previewRef = useRef(null)
  const dragStartEditRef = useRef(null)

  const selectedOverlay = edit.overlays.find((o) => o.id === selectedOverlayId) ?? null
  const trim = useTrimPlayback(edit)
  const dirty = JSON.stringify(edit) !== JSON.stringify(initialEdit)

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
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  function handleLoadedMetadata(e) {
    const d = e.currentTarget.duration
    setDuration(d)
    changeEdit((prev) => ({
      ...prev,
      trimEnd: prev.trimEnd == null ? d : prev.trimEnd,
      // Any overlay added before metadata loaded got created with
      // endTime: 0 (duration wasn't known yet) -- back-fill it to the
      // whole video now rather than leaving it permanently invisible.
      overlays: prev.overlays.map((o) => (o.endTime === 0 ? { ...o, endTime: d } : o)),
    }), { record: false })
  }

  function updateOverlay(id, patch) {
    changeEdit((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }))
  }

  function addOverlay(overlay) {
    changeEdit((prev) => ({ ...prev, overlays: [...prev.overlays, overlay] }))
    setSelectedOverlayId(overlay.id)
  }

  function removeOverlay(id) {
    changeEdit((prev) => ({ ...prev, overlays: prev.overlays.filter((o) => o.id !== id) }))
    setSelectedOverlayId((current) => (current === id ? null : current))
  }

  function startDrag(e, id) {
    e.stopPropagation()
    setSelectedOverlayId(id)
    dragStartEditRef.current = edit
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleDragMove(e, id) {
    if (e.buttons !== 1) return
    const rect = previewRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 2, 98)
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 2, 98)
    changeEdit((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o) => (o.id === id ? { ...o, x, y } : o)),
    }), { record: false })
  }

  function finishDrag() {
    const before = dragStartEditRef.current
    dragStartEditRef.current = null
    if (before && JSON.stringify(before) !== JSON.stringify(edit)) {
      setPast((items) => [...items.slice(-49), before])
      setFuture([])
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const saved = await updateVideoEdit(resource.id, edit)
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="video-editor-dialog-title"
      onClose={requestClose}
      overlayClassName="p-0 sm:p-4"
      panelClassName="relative flex h-full w-full flex-col overflow-hidden bg-card sm:h-[min(92vh,900px)] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-hairline"
    >
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3 py-3 sm:flex-nowrap sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="min-h-11 rounded-md px-3 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60"
          >
            Back
          </button>
          <div className="order-2 min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto">
            <div className="flex items-center gap-2">
              <h2 id="video-editor-dialog-title" className="truncate font-display text-xl text-ink">Edit Video</h2>
              {dirty && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-ink">Edited</span>}
            </div>
            <p className="truncate text-xs text-secondary sm:text-sm">{resource.title}</p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={undo} disabled={!past.length || saving} className="min-h-11 rounded-md px-3 text-sm font-medium text-ink hover:bg-paper disabled:opacity-40">
              Undo
            </button>
            <button type="button" onClick={redo} disabled={!future.length || saving} className="min-h-11 rounded-md px-3 text-sm font-medium text-ink hover:bg-paper disabled:opacity-40">
              Redo
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="min-h-11 rounded-md bg-moss px-4 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(240px,45%)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)] lg:grid-rows-1">
          <section className="flex min-h-0 flex-col bg-black" aria-label="Video preview and timeline">
            <div className="flex min-h-0 flex-1 items-center justify-center p-0 sm:p-4">

        <div
          ref={previewRef}
          className="relative max-h-full w-full overflow-hidden bg-black sm:rounded-xl"
        >
          {/* See EditedVideoPlayer.jsx -- without this, mobile Safari pops
              playback into its own native fullscreen layer, where the
              overlay div below (and dragging) can't reach it. */}
          <video
            ref={videoRef}
            src={contentFileUrl(resource)}
            controls
            playsInline
            onLoadedMetadata={(e) => {
              handleLoadedMetadata(e)
              trim.handleLoadedMetadata(e)
            }}
            onTimeUpdate={(e) => {
              trim.handleTimeUpdate(e)
              setCurrentTime(e.currentTarget.currentTime)
            }}
            onSeeking={trim.handleSeeking}
            onEnded={trim.handleNativeEnded}
            style={{ filter: buildFilterCss(edit.filter) }}
            className="w-full max-h-[45vh] block"
          />
          {/* pointer-events-none on the layer itself -- otherwise this
              full-size transparent div, sitting above the <video> in
              stacking order, would swallow every click meant for the
              browser's native controls (play, scrub, fullscreen) even in
              the empty space between overlays. Each overlay item opts back
              in with pointer-events-auto so dragging still works. */}
          <div className="absolute inset-0 pointer-events-none">
            {edit.overlays.map((o) => {
              // Scrubbing/playing the preview shows overlays exactly like
              // real playback would (see EditedVideoPlayer) -- that's the
              // "slide yourself and see the edits in place" behavior. The
              // one exception is whichever overlay is currently selected:
              // it stays visible (dimmed if outside its own window) so it's
              // always draggable, rather than vanishing out from under you
              // the moment you scrub away from its time range.
              const inWindow = currentTime >= o.startTime && currentTime <= o.endTime
              const isSelected = selectedOverlayId === o.id
              if (!inWindow && !isSelected) return null
              return (
                <div
                  key={o.id}
                  onPointerDown={(e) => startDrag(e, o.id)}
                  onPointerMove={(e) => handleDragMove(e, o.id)}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  role="button"
                  tabIndex={0}
                  aria-label={`${o.kind === 'text' ? 'Text' : 'Sticker'} overlay: ${o.content}. Use arrow keys to move.`}
                  onKeyDown={(e) => {
                    const amount = e.shiftKey ? 5 : 1
                    const movement = {
                      ArrowLeft: { x: clamp(o.x - amount, 2, 98) },
                      ArrowRight: { x: clamp(o.x + amount, 2, 98) },
                      ArrowUp: { y: clamp(o.y - amount, 2, 98) },
                      ArrowDown: { y: clamp(o.y + amount, 2, 98) },
                    }[e.key]
                    if (movement) {
                      e.preventDefault()
                      updateOverlay(o.id, movement)
                    }
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move select-none max-w-[80%] text-center px-1 rounded pointer-events-auto ${
                    isSelected ? 'ring-2 ring-gold' : ''
                  } ${!inWindow ? 'opacity-40' : ''}`}
                  style={{ left: `${o.x}%`, top: `${o.y}%` }}
                >
                  {o.kind === 'text' ? (
                    <span
                      style={{ color: o.color, fontSize: OVERLAY_SIZE_PX[o.size] }}
                      className="font-bold whitespace-pre-wrap [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]"
                    >
                      {o.content}
                    </span>
                  ) : (
                    <span style={{ fontSize: OVERLAY_SIZE_PX[o.size] }}>{o.content}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
            </div>

            <div className="border-t border-white/20 bg-[#111] px-4 py-3 text-white sm:px-6">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-white/80">Video Timeline</p>
                {duration && <p className="text-xs tabular-nums text-white/60">{formatTime(currentTime)} / {formatTime(duration)}</p>}
              </div>
              {duration ? (
                <TimelineRangeSlider
                  duration={duration}
                  start={edit.trimStart}
                  end={edit.trimEnd ?? duration}
                  currentTime={currentTime}
                  label="Video trim"
                  onChange={({ start, end }) => changeEdit((prev) => ({ ...prev, trimStart: start, trimEnd: end }))}
                />
              ) : <p className="text-xs text-white/60">Loading video…</p>}
            </div>
          </section>

          <aside className="min-h-0 overflow-y-auto overscroll-contain bg-card" aria-label="Editing tools">
            <div className="p-4 sm:p-6">

        {edit.overlays.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {edit.overlays.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedOverlayId(o.id)}
                aria-pressed={selectedOverlayId === o.id}
                className={`min-h-11 rounded-full border px-3 text-xs font-medium ${
                  selectedOverlayId === o.id
                    ? 'border-gold bg-gold/10 text-ink'
                    : 'border-hairline text-secondary hover:text-ink'
                }`}
              >
                {o.kind === 'text' ? `“${o.content.slice(0, 12)}${o.content.length > 12 ? '…' : ''}”` : o.content}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-4 gap-1 border-b border-hairline" role="tablist" aria-label="Video editing tools">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
              className={`min-h-11 px-2 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.id ? 'border-moss text-ink' : 'border-transparent text-secondary hover:text-ink'
              }`}
            >
              {t.id === 'icons' ? 'Stickers' : t.label}
            </button>
          ))}
        </div>

        <div className="pt-4 space-y-4">
          {tab === 'text' && (
            <button
              type="button"
              onClick={() => addOverlay(createTextOverlay(edit.trimEnd ?? duration))}
              className="min-h-11 rounded-md border border-hairline px-4 text-sm font-medium text-ink hover:bg-paper"
            >
              Add Text
            </button>
          )}

          {tab === 'icons' && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="Stickers">
              {STICKER_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => addOverlay(createIconOverlay(emoji, edit.trimEnd ?? duration))}
                  className="min-h-11 rounded-md border border-hairline text-xl hover:bg-paper"
                  aria-label={`Add ${emoji} sticker`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {tab === 'trim' && (
            <TrimTab
              edit={edit}
              duration={duration}
              currentTime={currentTime}
              onChange={(patch) => changeEdit((prev) => ({ ...prev, ...patch }))}
              getCurrentTime={() => videoRef.current?.currentTime ?? 0}
            />
          )}

          {tab === 'adjust' && (
            <AdjustTab
              edit={edit}
              onFilterChange={(patch) => changeEdit((prev) => ({ ...prev, filter: { ...prev.filter, ...patch } }))}
              onSpeedChange={(playbackRate) => {
                changeEdit((prev) => ({ ...prev, playbackRate }))
                if (videoRef.current) videoRef.current.playbackRate = playbackRate
              }}
            />
          )}

          {selectedOverlay && (
            <div className="rounded-md border border-hairline p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">
                  Editing {selectedOverlay.kind === 'text' ? 'text' : 'sticker'}
                </p>
                <button
                  type="button"
                  onClick={() => removeOverlay(selectedOverlay.id)}
                  className="text-xs text-red-700 hover:underline"
                >
                  Delete
                </button>
              </div>

              {selectedOverlay.kind === 'text' && (
                <>
                  <textarea
                    aria-label="Overlay text"
                    value={selectedOverlay.content}
                    onChange={(e) => updateOverlay(selectedOverlay.id, { content: e.target.value })}
                    rows={2}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-secondary" htmlFor="overlayColor">
                      Color
                    </label>
                    <input
                      id="overlayColor"
                      type="color"
                      value={selectedOverlay.color}
                      onChange={(e) => updateOverlay(selectedOverlay.id, { color: e.target.value })}
                      className="h-11 w-14 rounded border border-hairline bg-paper"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center gap-2">
                <span className="text-xs text-secondary">Size</span>
                {SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => updateOverlay(selectedOverlay.id, { size })}
                    aria-pressed={selectedOverlay.size === size}
                    className={`min-h-11 rounded-md border px-3 text-xs font-medium capitalize ${
                      selectedOverlay.size === size
                        ? 'border-moss bg-moss text-paper'
                        : 'border-hairline text-ink hover:bg-paper'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-xs text-secondary mb-1">Show on video from…until</p>
                {duration ? (
                  <TimelineRangeSlider
                    duration={duration}
                    start={selectedOverlay.startTime}
                    end={selectedOverlay.endTime}
                    currentTime={currentTime}
                    label={`${selectedOverlay.kind === 'text' ? 'Text' : 'Sticker'} timing`}
                    onChange={({ start, end }) => updateOverlay(selectedOverlay.id, { startTime: start, endTime: end })}
                  />
                ) : (
                  <p className="text-xs text-secondary">Loading video…</p>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-700" role="alert">Couldn’t save your edit. {error}</p>}

              <div className="mt-6 rounded-lg bg-paper p-3 text-xs leading-relaxed text-secondary">
                Your edits are non-destructive and update this shared video everywhere it is used.
              </div>
              {dirty && (
                <button
                  type="button"
                  onClick={() => changeEdit(initialEdit)}
                  className="mt-3 min-h-11 rounded-md px-3 text-sm font-medium text-secondary hover:bg-paper hover:text-ink"
                >
                  Restore Original
                </button>
              )}
            </div>
          </aside>
        </div>

        <p className="sr-only" aria-live="polite">{saving ? 'Saving video edit' : error ? 'Video edit could not be saved' : ''}</p>

        {confirmDiscard && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4">
            <div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl">
              <h3 id="discard-title" className="font-display text-lg text-ink">Discard Your Changes?</h3>
              <p className="mt-2 text-sm text-secondary">Your video has unsaved edits. You can keep editing or discard them and return to the library.</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmDiscard(false)} className="min-h-11 rounded-md border border-hairline px-4 text-sm font-medium text-ink hover:bg-paper" autoFocus>
                  Keep Editing
                </button>
                <button type="button" onClick={onClose} className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-medium text-white hover:opacity-90">
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
    </AccessibleDialog>
  )
}

function TrimTab({ edit, duration, currentTime, onChange, getCurrentTime }) {
  if (!duration) return <p className="text-sm text-secondary">Loading video…</p>
  return (
    <div>
      <TimelineRangeSlider
        duration={duration}
        start={edit.trimStart}
        end={edit.trimEnd ?? duration}
        currentTime={currentTime}
        label="Video trim"
        onChange={({ start, end }) => onChange({ trimStart: start, trimEnd: end })}
      />
      <div className="flex items-center gap-4 mt-1">
        <button
          type="button"
          onClick={() => onChange({ trimStart: clamp(getCurrentTime(), 0, (edit.trimEnd ?? duration) - MIN_RANGE_GAP) })}
          className="min-h-11 rounded-md px-2 text-xs font-medium text-moss hover:bg-paper"
        >
          Set Start Here
        </button>
        <button
          type="button"
          onClick={() => onChange({ trimEnd: clamp(getCurrentTime(), edit.trimStart + MIN_RANGE_GAP, duration) })}
          className="min-h-11 rounded-md px-2 text-xs font-medium text-moss hover:bg-paper"
        >
          Set End Here
        </button>
      </div>
    </div>
  )
}

// Shared by the Trim tab (trimStart/trimEnd) and each selected overlay's
// visibility window (startTime/endTime) -- a horizontal track with two
// pointer-draggable handles, plus a playhead tick synced to the preview
// video's currentTime for context. Replaces a pair of plain number inputs
// that fought typing (their `value` was a freshly `.toFixed(1)`-formatted
// string on every keystroke, resetting the cursor mid-edit) with direct
// manipulation instead -- same drag-via-pointer-capture technique already
// used for positioning overlays on the video canvas above.
const MIN_RANGE_GAP = 0.1

function TimelineRangeSlider({ duration, start, end, currentTime, onChange, label = 'Timeline range' }) {
  const trackRef = useRef(null)

  function timeAtClientX(clientX) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !rect.width) return 0
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration)
  }

  function handleMove(e, which) {
    if (e.buttons !== 1) return
    const t = timeAtClientX(e.clientX)
    if (which === 'start') onChange({ start: clamp(t, 0, end - MIN_RANGE_GAP), end })
    else onChange({ start, end: clamp(t, start + MIN_RANGE_GAP, duration) })
  }

  function handleKeyDown(e, which) {
    const step = e.shiftKey ? 1 : 0.1
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    if (which === 'start') {
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? end - MIN_RANGE_GAP : start + (e.key === 'ArrowLeft' ? -step : step)
      onChange({ start: clamp(next, 0, end - MIN_RANGE_GAP), end })
    } else {
      const next = e.key === 'Home' ? start + MIN_RANGE_GAP : e.key === 'End' ? duration : end + (e.key === 'ArrowLeft' ? -step : step)
      onChange({ start, end: clamp(next, start + MIN_RANGE_GAP, duration) })
    }
  }

  const startPct = (start / duration) * 100
  const endPct = (end / duration) * 100
  const playheadPct = clamp((currentTime / duration) * 100, 0, 100)

  return (
    <div>
      <div ref={trackRef} className="relative h-6" style={{ touchAction: 'none' }}>
        <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 rounded-full bg-hairline" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-moss"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-px h-4 bg-gold"
          style={{ left: `${playheadPct}%` }}
          title={`Playhead: ${formatTime(currentTime)}`}
        />
        {[
          { key: 'start', pct: startPct },
          { key: 'end', pct: endPct },
        ].map(({ key, pct }) => (
          <button
            key={key}
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => handleMove(e, key)}
            onKeyDown={(e) => handleKeyDown(e, key)}
            role="slider"
            aria-label={`${label} ${key}`}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={key === 'start' ? start : end}
            aria-valuetext={formatTime(key === 'start' ? start : end)}
            className="absolute top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full bg-transparent before:absolute before:left-1/2 before:top-1/2 before:h-5 before:w-5 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:border-2 before:border-card before:bg-moss before:shadow cursor-ew-resize"
            style={{ left: `${pct}%` }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-secondary mt-0.5">
        <span>{formatTime(start)}</span>
        <span>{formatTime(end)}</span>
      </div>
    </div>
  )
}

const FILTER_CONTROLS = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturate', label: 'Saturation' },
]

function AdjustTab({ edit, onFilterChange, onSpeedChange }) {
  return (
    <div className="space-y-4">
      {FILTER_CONTROLS.map(({ key, label }) => (
        <div key={key}>
          <div className="flex items-center justify-between text-sm text-ink mb-1">
            <label htmlFor={`video-filter-${key}`}>{label}</label>
            <span className="text-secondary">{edit.filter[key]}%</span>
          </div>
          <input
            id={`video-filter-${key}`}
            type="range"
            min={50}
            max={150}
            value={edit.filter[key]}
            onChange={(e) => onFilterChange({ [key]: Number(e.target.value) })}
            className="w-full accent-moss"
          />
        </div>
      ))}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onFilterChange({ grayscale: edit.filter.grayscale > 0 ? 0 : 100 })}
          aria-pressed={edit.filter.grayscale > 0}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            edit.filter.grayscale > 0 ? 'border-moss bg-moss text-paper' : 'border-hairline text-ink hover:bg-paper'
          }`}
        >
          Grayscale
        </button>
        <button
          type="button"
          onClick={() => onFilterChange({ sepia: edit.filter.sepia > 0 ? 0 : 100 })}
          aria-pressed={edit.filter.sepia > 0}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            edit.filter.sepia > 0 ? 'border-moss bg-moss text-paper' : 'border-hairline text-ink hover:bg-paper'
          }`}
        >
          Sepia
        </button>
      </div>

      <div>
        <p className="text-sm text-ink mb-1">Playback speed</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => onSpeedChange(rate)}
              aria-pressed={edit.playbackRate === rate}
              className={`min-h-11 rounded-md border px-3 text-xs font-medium ${
                edit.playbackRate === rate
                  ? 'border-moss bg-moss text-paper'
                  : 'border-hairline text-ink hover:bg-paper'
              }`}
            >
              {rate}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
