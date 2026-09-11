import { useMemo, useRef, useState } from 'react'
import { contentFileUrl, updateVideoEdit } from '../lib/courseContent'
import AccessibleDialog from './AccessibleDialog'
import {
  OVERLAY_SIZE_PX,
  PLAYBACK_RATES,
  STICKER_EMOJI,
  TEXT_BACKGROUND_PRESETS,
  TEXT_COLOR_PRESETS,
  buildFilterCss,
  clamp,
  createIconOverlay,
  createTextOverlay,
  formatTime,
  normalizeVideoEdit,
  useTrimPlayback,
} from '../lib/videoEdit'

function TextToolIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}
function StickerToolIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9" y2="9.5" /><line x1="15" y1="9" x2="15" y2="9.5" />
    </svg>
  )
}
function TrimToolIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}
function AdjustToolIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  )
}

const TABS = [
  { id: 'text', label: 'Text', Icon: TextToolIcon },
  { id: 'icons', label: 'Stickers', Icon: StickerToolIcon },
  { id: 'trim', label: 'Trim', Icon: TrimToolIcon },
  { id: 'adjust', label: 'Adjust', Icon: AdjustToolIcon },
]

const SIZES = ['small', 'medium', 'large']

// Preset color circles plus a dashed "custom" swatch that wraps a hidden
// native <input type="color"> -- clicking it opens the OS color picker the
// same way the plain input used to, without needing its own always-visible
// square. Shared by text color and the new background-pill color.
function ColorSwatchRow({ label, presets, value, onChange, hideLabel = false }) {
  return (
    <div>
      {!hideLabel && <p className="text-xs font-medium text-secondary mb-1.5">{label}</p>}
      <div className="flex items-center gap-1.5 flex-wrap">
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange(color)}
            aria-label={`${label}: ${color}`}
            aria-pressed={value === color}
            className={`h-8 w-8 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-card transition-transform active:scale-90 ${
              value === color ? 'ring-moss' : 'ring-transparent'
            }`}
            style={{ backgroundColor: color, boxShadow: '0 0 0 1px var(--color-hairline) inset' }}
          />
        ))}
        <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-hairline text-secondary hover:text-ink" title="Custom color">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20l9-9-4-4-9 9v4h4z" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L18 8l-3-3z" />
          </svg>
          <input
            type="color"
            aria-label={`${label}: custom`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}

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
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-card px-3 py-3 shadow-sm sm:flex-nowrap sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            aria-label="Close editor"
            title="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-transform hover:bg-paper active:scale-90 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
          <div className="order-2 min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto">
            <div className="flex items-center gap-2">
              <h2 id="video-editor-dialog-title" className="truncate font-display text-xl text-ink">Edit Video</h2>
              {dirty && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-ink">Edited</span>}
            </div>
            <p className="truncate text-xs text-secondary sm:text-sm">{resource.title}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={undo} disabled={!past.length || saving} aria-label="Undo" title="Undo"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-transform hover:bg-paper active:scale-90 disabled:opacity-30">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button type="button" onClick={redo} disabled={!future.length || saving} aria-label="Redo" title="Redo"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-transform hover:bg-paper active:scale-90 disabled:opacity-30">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 14 20 9l-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="min-h-11 rounded-full bg-moss px-5 text-sm font-semibold text-paper shadow-sm transition-transform hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
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
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move select-none max-w-[80%] text-center px-1 rounded pointer-events-auto transition-[opacity,box-shadow] ${
                    isSelected ? 'ring-2 ring-gold ring-offset-2 ring-offset-black/40' : ''
                  } ${!inWindow ? 'opacity-40' : ''}`}
                  style={{ left: `${o.x}%`, top: `${o.y}%` }}
                >
                  {o.kind === 'text' ? (
                    <span
                      style={{
                        color: o.color,
                        fontSize: OVERLAY_SIZE_PX[o.size],
                        backgroundColor: o.background || undefined,
                        padding: o.background ? '0.25em 0.6em' : undefined,
                        borderRadius: o.background ? '999px' : undefined,
                      }}
                      className={`font-bold whitespace-pre-wrap ${o.background ? '' : '[text-shadow:0_1px_3px_rgba(0,0,0,0.8)]'}`}
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
                  dark
                  onChange={({ start, end }) => changeEdit((prev) => ({ ...prev, trimStart: start, trimEnd: end }))}
                />
              ) : <p className="text-xs text-white/60">Loading video…</p>}
            </div>
          </section>

          <aside className="min-h-0 overflow-y-auto overscroll-contain rounded-t-2xl bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:rounded-none lg:shadow-none" aria-label="Editing tools">
            {/* Purely a visual cue that this panel is a bottom sheet on
                mobile (where the grid stacks video-on-top) -- there's no
                swipe-to-dismiss gesture behind it, closing still only
                happens via the header's Close button. */}
            <div className="flex justify-center pt-2 lg:hidden">
              <div className="h-1 w-10 rounded-full bg-hairline" />
            </div>
            <div className="p-4 sm:p-6">

        {edit.overlays.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {edit.overlays.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedOverlayId(o.id)}
                aria-pressed={selectedOverlayId === o.id}
                className={`min-h-11 rounded-full border px-3 text-xs font-medium transition-transform active:scale-95 ${
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

        <div className="grid grid-cols-4 gap-1.5 rounded-2xl bg-paper p-1.5" role="tablist" aria-label="Video editing tools">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              role="tab"
              aria-selected={tab === id}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                tab === id ? 'bg-moss text-paper shadow-sm' : 'text-secondary hover:bg-card hover:text-ink'
              }`}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        <div className="pt-4 space-y-4">
          {tab === 'text' && (
            <button
              type="button"
              onClick={() => addOverlay(createTextOverlay(edit.trimEnd ?? duration))}
              className="flex min-h-11 items-center gap-2 rounded-full bg-moss px-5 text-sm font-semibold text-paper shadow-sm transition-transform hover:opacity-90 active:scale-95"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Text
            </button>
          )}

          {tab === 'icons' && (
            <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6" aria-label="Stickers">
              {STICKER_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => addOverlay(createIconOverlay(emoji, edit.trimEnd ?? duration))}
                  className="flex aspect-square min-h-11 items-center justify-center rounded-full bg-paper text-2xl shadow-sm transition-transform hover:bg-hairline/40 active:scale-90"
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
            <div className="rounded-2xl border border-hairline bg-card p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">
                  Editing {selectedOverlay.kind === 'text' ? 'text' : 'sticker'}
                </p>
                <button
                  type="button"
                  onClick={() => removeOverlay(selectedOverlay.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-red-700 transition-transform hover:bg-red-700/10 active:scale-90"
                  aria-label="Delete overlay"
                  title="Delete"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>

              {selectedOverlay.kind === 'text' && (
                <>
                  <textarea
                    aria-label="Overlay text"
                    value={selectedOverlay.content}
                    onChange={(e) => updateOverlay(selectedOverlay.id, { content: e.target.value })}
                    rows={2}
                    className="w-full rounded-xl border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                  />
                  <ColorSwatchRow
                    label="Text color"
                    presets={TEXT_COLOR_PRESETS}
                    value={selectedOverlay.color}
                    onChange={(color) => updateOverlay(selectedOverlay.id, { color })}
                  />
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-secondary">Background pill</span>
                      <button
                        type="button"
                        onClick={() => updateOverlay(selectedOverlay.id, { background: selectedOverlay.background ? null : TEXT_BACKGROUND_PRESETS[0] })}
                        aria-pressed={Boolean(selectedOverlay.background)}
                        className={`min-h-8 rounded-full px-3 text-xs font-medium transition-colors ${
                          selectedOverlay.background ? 'bg-moss text-paper' : 'bg-paper text-secondary hover:text-ink'
                        }`}
                      >
                        {selectedOverlay.background ? 'On' : 'Off'}
                      </button>
                    </div>
                    {selectedOverlay.background && (
                      <ColorSwatchRow
                        label="Background color"
                        presets={TEXT_BACKGROUND_PRESETS}
                        value={selectedOverlay.background}
                        onChange={(background) => updateOverlay(selectedOverlay.id, { background })}
                        hideLabel
                      />
                    )}
                  </div>
                </>
              )}

              <div>
                <p className="text-xs font-medium text-secondary mb-1.5">Size</p>
                <div className="flex items-center gap-1.5">
                  {SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => updateOverlay(selectedOverlay.id, { size })}
                      aria-pressed={selectedOverlay.size === size}
                      className={`min-h-9 rounded-full border px-3.5 text-xs font-medium capitalize transition-transform active:scale-95 ${
                        selectedOverlay.size === size
                          ? 'border-moss bg-moss text-paper'
                          : 'border-hairline text-ink hover:bg-paper'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-secondary mb-1.5">Show on video from…until</p>
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
                  className="mt-3 min-h-11 rounded-full px-3 text-sm font-medium text-secondary transition-transform hover:bg-paper hover:text-ink active:scale-95"
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
            <div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl">
              <h3 id="discard-title" className="font-display text-lg text-ink">Discard Your Changes?</h3>
              <p className="mt-2 text-sm text-secondary">Your video has unsaved edits. You can keep editing or discard them and return to the library.</p>
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
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => onChange({ trimStart: clamp(getCurrentTime(), 0, (edit.trimEnd ?? duration) - MIN_RANGE_GAP) })}
          className="min-h-9 rounded-full bg-paper px-3.5 text-xs font-medium text-moss transition-transform hover:bg-hairline/40 active:scale-95"
        >
          Set Start Here
        </button>
        <button
          type="button"
          onClick={() => onChange({ trimEnd: clamp(getCurrentTime(), edit.trimStart + MIN_RANGE_GAP, duration) })}
          className="min-h-9 rounded-full bg-paper px-3.5 text-xs font-medium text-moss transition-transform hover:bg-hairline/40 active:scale-95"
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

function TimelineRangeSlider({ duration, start, end, currentTime, onChange, label = 'Timeline range', dark = false }) {
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
      <div ref={trackRef} className="relative h-7" style={{ touchAction: 'none' }}>
        <div className={`absolute top-1/2 -translate-y-1/2 w-full h-2 rounded-full ${dark ? 'bg-white/15' : 'bg-hairline'}`} />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-gradient-to-r from-moss to-emerald-400 shadow-[0_0_10px_rgba(74,103,65,0.6)]"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 rounded-full bg-gold shadow-[0_0_6px_var(--color-gold)]"
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
            className={`absolute top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full bg-transparent transition-transform active:scale-110 before:absolute before:left-1/2 before:top-1/2 before:h-6 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:border-2 before:bg-moss before:shadow-[0_2px_8px_rgba(0,0,0,0.4)] cursor-ew-resize ${dark ? 'before:border-white' : 'before:border-card'}`}
            style={{ left: `${pct}%` }}
          />
        ))}
      </div>
      <div className={`flex items-center justify-between text-[10px] font-mono mt-0.5 ${dark ? 'text-white/60' : 'text-secondary'}`}>
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
    <div className="space-y-5">
      <div className="rounded-2xl border border-hairline bg-card p-4 shadow-sm space-y-4">
        {FILTER_CONTROLS.map(({ key, label }) => {
          const pct = ((edit.filter[key] - 50) / 100) * 100
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-sm text-ink mb-1">
                <label htmlFor={`video-filter-${key}`} className="font-medium">{label}</label>
                <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-mono text-secondary">{edit.filter[key]}%</span>
              </div>
              <input
                id={`video-filter-${key}`}
                type="range"
                min={50}
                max={150}
                value={edit.filter[key]}
                onChange={(e) => onFilterChange({ [key]: Number(e.target.value) })}
                className="w-full accent-moss"
                style={{ background: `linear-gradient(to right, var(--color-moss) ${pct}%, var(--color-hairline) ${pct}%)`, height: '6px', borderRadius: '999px', appearance: 'none' }}
              />
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onFilterChange({ grayscale: edit.filter.grayscale > 0 ? 0 : 100 })}
          aria-pressed={edit.filter.grayscale > 0}
          className={`min-h-10 rounded-full border px-4 text-sm font-medium transition-transform active:scale-95 ${
            edit.filter.grayscale > 0 ? 'border-moss bg-moss text-paper' : 'border-hairline text-ink hover:bg-paper'
          }`}
        >
          Grayscale
        </button>
        <button
          type="button"
          onClick={() => onFilterChange({ sepia: edit.filter.sepia > 0 ? 0 : 100 })}
          aria-pressed={edit.filter.sepia > 0}
          className={`min-h-10 rounded-full border px-4 text-sm font-medium transition-transform active:scale-95 ${
            edit.filter.sepia > 0 ? 'border-moss bg-moss text-paper' : 'border-hairline text-ink hover:bg-paper'
          }`}
        >
          Sepia
        </button>
      </div>

      <div>
        <p className="text-sm font-medium text-ink mb-1.5">Playback speed</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => onSpeedChange(rate)}
              aria-pressed={edit.playbackRate === rate}
              className={`min-h-11 rounded-full border px-3.5 text-xs font-medium transition-transform active:scale-95 ${
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
