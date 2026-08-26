import { useRef, useState } from 'react'
import { contentFileUrl, updateVideoEdit } from '../lib/courseContent'
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
  const [edit, setEdit] = useState(() => normalizeVideoEdit(resource.video_edit))
  const [duration, setDuration] = useState(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [tab, setTab] = useState('text')
  const [selectedOverlayId, setSelectedOverlayId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const videoRef = useRef(null)
  const previewRef = useRef(null)

  const selectedOverlay = edit.overlays.find((o) => o.id === selectedOverlayId) ?? null
  const trim = useTrimPlayback(edit)

  function handleLoadedMetadata(e) {
    const d = e.currentTarget.duration
    setDuration(d)
    setEdit((prev) => ({
      ...prev,
      trimEnd: prev.trimEnd == null ? d : prev.trimEnd,
      // Any overlay added before metadata loaded got created with
      // endTime: 0 (duration wasn't known yet) -- back-fill it to the
      // whole video now rather than leaving it permanently invisible.
      overlays: prev.overlays.map((o) => (o.endTime === 0 ? { ...o, endTime: d } : o)),
    }))
  }

  function updateOverlay(id, patch) {
    setEdit((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }))
  }

  function addOverlay(overlay) {
    setEdit((prev) => ({ ...prev, overlays: [...prev.overlays, overlay] }))
    setSelectedOverlayId(overlay.id)
  }

  function removeOverlay(id) {
    setEdit((prev) => ({ ...prev, overlays: prev.overlays.filter((o) => o.id !== id) }))
    setSelectedOverlayId((current) => (current === id ? null : current))
  }

  function startDrag(e, id) {
    e.stopPropagation()
    setSelectedOverlayId(id)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handleDragMove(e, id) {
    if (e.buttons !== 1) return
    const rect = previewRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 2, 98)
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 2, 98)
    updateOverlay(id, { x, y })
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl text-ink mb-1">Edit video</h2>
        <p className="text-sm text-secondary mb-4 truncate">{resource.title}</p>

        <div
          ref={previewRef}
          className="relative bg-black rounded-md overflow-hidden"
          style={{ touchAction: 'none' }}
        >
          <video
            ref={videoRef}
            src={contentFileUrl(resource)}
            controls
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
          <div className="absolute inset-0">
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
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move select-none max-w-[80%] text-center px-1 rounded ${
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

        {edit.overlays.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {edit.overlays.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedOverlayId(o.id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
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

        <div className="flex items-center gap-1 border-b border-hairline mt-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.id ? 'border-moss text-ink' : 'border-transparent text-secondary hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="pt-4 space-y-4">
          {tab === 'text' && (
            <button
              type="button"
              onClick={() => addOverlay(createTextOverlay(edit.trimEnd ?? duration))}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
            >
              + Add text
            </button>
          )}

          {tab === 'icons' && (
            <div className="grid grid-cols-8 gap-1.5">
              {STICKER_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => addOverlay(createIconOverlay(emoji, edit.trimEnd ?? duration))}
                  className="rounded-md border border-hairline text-xl py-1.5 hover:bg-paper"
                  title="Add sticker"
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
              onChange={(patch) => setEdit((prev) => ({ ...prev, ...patch }))}
              getCurrentTime={() => videoRef.current?.currentTime ?? 0}
            />
          )}

          {tab === 'adjust' && (
            <AdjustTab
              edit={edit}
              onFilterChange={(patch) => setEdit((prev) => ({ ...prev, filter: { ...prev.filter, ...patch } }))}
              onSpeedChange={(playbackRate) => {
                setEdit((prev) => ({ ...prev, playbackRate }))
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
                      className="h-8 w-12 rounded border border-hairline bg-paper"
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
                    className={`rounded-md border px-2 py-1 text-xs font-medium capitalize ${
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
                    onChange={({ start, end }) => updateOverlay(selectedOverlay.id, { startTime: start, endTime: end })}
                  />
                ) : (
                  <p className="text-xs text-secondary">Loading video…</p>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-700 mt-4">{error}</p>}

        <div className="flex items-center gap-2 mt-6 pt-4 border-t border-hairline">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save edit'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
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
        onChange={({ start, end }) => onChange({ trimStart: start, trimEnd: end })}
      />
      <div className="flex items-center gap-4 mt-1">
        <button type="button" onClick={() => onChange({ trimStart: getCurrentTime() })} className="text-xs text-moss font-medium">
          Set start to current position
        </button>
        <button type="button" onClick={() => onChange({ trimEnd: getCurrentTime() })} className="text-xs text-moss font-medium">
          Set end to current position
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

function TimelineRangeSlider({ duration, start, end, currentTime, onChange }) {
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
          <div
            key={key}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => handleMove(e, key)}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-moss border-2 border-card shadow cursor-ew-resize"
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
            <span>{label}</span>
            <span className="text-secondary">{edit.filter[key]}%</span>
          </div>
          <input
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
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            edit.filter.grayscale > 0 ? 'border-moss bg-moss text-paper' : 'border-hairline text-ink hover:bg-paper'
          }`}
        >
          Grayscale
        </button>
        <button
          type="button"
          onClick={() => onFilterChange({ sepia: edit.filter.sepia > 0 ? 0 : 100 })}
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
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
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
