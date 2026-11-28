import { useEffect, useRef } from 'react'
import { clamp, formatTime, shiftRange } from '../../lib/videoEdit'

const THUMBNAIL_COUNT = 10
export const MIN_RANGE_GAP = 0.1

// Frames drawn from a hidden copy of the video, one per slice of its length.
// They're painted straight onto canvases (never read back), so a video from
// another origin still shows.
function useFilmstrip(src, duration, canvasesRef) {
  useEffect(() => {
    if (!src || !duration) return undefined
    let cancelled = false
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.src = src

    function seek(time) {
      return new Promise((resolve) => {
        const done = () => {
          video.removeEventListener('seeked', done)
          video.removeEventListener('error', done)
          resolve()
        }
        video.addEventListener('seeked', done)
        video.addEventListener('error', done)
        video.currentTime = time
      })
    }

    async function draw() {
      await new Promise((resolve) => {
        if (video.readyState >= 1) resolve()
        else video.addEventListener('loadedmetadata', resolve, { once: true })
      })
      for (let i = 0; i < THUMBNAIL_COUNT && !cancelled; i += 1) {
        await seek(Math.min(duration - 0.05, ((i + 0.5) * duration) / THUMBNAIL_COUNT))
        const canvas = canvasesRef.current[i]
        if (cancelled || !canvas || !video.videoWidth) continue
        canvas.width = 96
        canvas.height = Math.round((96 * video.videoHeight) / video.videoWidth) || 54
        try {
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        } catch {
          // A frame that can't be drawn just stays blank.
        }
      }
    }
    draw()
    return () => {
      cancelled = true
      video.removeAttribute('src')
      video.load()
    }
  }, [src, duration, canvasesRef])
}

function RangeHandle({ label, value, min, max, pct, onChange, onGestureStart, onGestureEnd, timeAt, side }) {
  function handleKeyDown(e) {
    const step = e.shiftKey ? 1 : 0.1
    const next = { ArrowLeft: value - step, ArrowRight: value + step, Home: min, End: max }[e.key]
    if (next === undefined) return
    e.preventDefault()
    onChange(clamp(next, min, max), true)
  }
  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(1))}
      aria-valuetext={formatTime(value)}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        onGestureStart()
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return
        onChange(clamp(timeAt(e.clientX), min, max), false)
      }}
      onPointerUp={onGestureEnd}
      onPointerCancel={onGestureEnd}
      onKeyDown={handleKeyDown}
      className={`absolute top-0 bottom-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
        side === 'start' ? 'rounded-l-md' : 'rounded-r-md'
      }`}
      style={{ left: `${pct}%` }}
    >
      <span className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 rounded-md bg-white shadow" aria-hidden="true">
        <span className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-black/50" />
      </span>
    </button>
  )
}

// The whole video as a strip of frames: drag the white ends to trim, tap or
// drag along it to move the playhead. Under it, one bar per text or sticker
// showing when it's on screen -- drag the bar to move it, or its ends to
// change when it appears and goes.
export default function FilmstripTimeline({
  src,
  duration,
  currentTime,
  trimStart,
  trimEnd,
  overlays,
  selectedId,
  onSeek,
  onTrimChange,
  onOverlayTimeChange,
  onSelectOverlay,
  onGestureStart,
  onGestureEnd,
}) {
  const stripRef = useRef(null)
  const canvasesRef = useRef([])
  const moveRef = useRef(null)
  useFilmstrip(src, duration, canvasesRef)

  if (!duration) return <p className="py-3 text-xs text-white/60">Loading video…</p>

  function timeAt(clientX) {
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect?.width) return 0
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration)
  }

  const pct = (t) => (t / duration) * 100
  const end = trimEnd ?? duration

  return (
    <div className="select-none space-y-1.5">
      <div
        ref={stripRef}
        className="relative h-12 cursor-pointer select-none rounded-md bg-white/10 touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          onSeek(timeAt(e.clientX))
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) onSeek(timeAt(e.clientX))
        }}
      >
        <div className="absolute inset-0 flex overflow-hidden rounded-md" aria-hidden="true">
          {Array.from({ length: THUMBNAIL_COUNT }, (_, i) => (
            <canvas
              key={i}
              ref={(el) => { canvasesRef.current[i] = el }}
              className="h-full min-w-0 flex-1 object-cover"
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-black/65" style={{ width: `${pct(trimStart)}%` }} aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-black/65" style={{ width: `${100 - pct(end)}%` }} aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-white"
          style={{ left: `${pct(trimStart)}%`, width: `${Math.max(0, pct(end) - pct(trimStart))}%` }}
          aria-hidden="true"
        />
        <RangeHandle
          label="Trim start"
          side="start"
          value={trimStart}
          min={0}
          max={end - MIN_RANGE_GAP}
          pct={pct(trimStart)}
          timeAt={timeAt}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          onChange={(start, record) => {
            onTrimChange({ start, end }, record)
            onSeek(start)
          }}
        />
        <RangeHandle
          label="Trim end"
          side="end"
          value={end}
          min={trimStart + MIN_RANGE_GAP}
          max={duration}
          pct={pct(end)}
          timeAt={timeAt}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          onChange={(value, record) => {
            onTrimChange({ start: trimStart, end: value }, record)
            onSeek(value)
          }}
        />
        <div
          className="pointer-events-none absolute -inset-y-1 z-20 w-0.5 -translate-x-1/2 rounded-full bg-gold shadow-[0_0_6px_var(--color-gold)]"
          style={{ left: `${clamp(pct(currentTime), 0, 100)}%` }}
          aria-hidden="true"
        />
      </div>

      {overlays.length > 0 && (
        <ul className="-mx-3 max-h-24 space-y-1 overflow-y-auto overflow-x-hidden px-3" aria-label="When each text and sticker shows">
          {overlays.map((o) => {
            const selected = o.id === selectedId
            const name = o.kind === 'text' ? `Text “${o.content.slice(0, 24)}”` : `Sticker ${o.content}`
            return (
              <li key={o.id} className="relative h-7">
                <div className="absolute inset-0 rounded bg-white/5" aria-hidden="true" />
                <button
                  type="button"
                  aria-label={`${name}: shown ${formatTime(o.startTime)} to ${formatTime(o.endTime)}. Drag, or use the arrow keys, to move it.`}
                  aria-pressed={selected}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    onSelectOverlay(o.id)
                    onGestureStart()
                    moveRef.current = { x: e.clientX, start: o.startTime, end: o.endTime }
                  }}
                  onPointerMove={(e) => {
                    const from = moveRef.current
                    if (!from || e.buttons !== 1) return
                    const rect = stripRef.current?.getBoundingClientRect()
                    if (!rect?.width) return
                    const delta = ((e.clientX - from.x) / rect.width) * duration
                    onOverlayTimeChange(o.id, shiftRange(from.start, from.end, delta, duration), false)
                  }}
                  onPointerUp={() => {
                    moveRef.current = null
                    onGestureEnd()
                  }}
                  onPointerCancel={() => {
                    moveRef.current = null
                    onGestureEnd()
                  }}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? 1 : 0.1
                    const delta = { ArrowLeft: -step, ArrowRight: step }[e.key]
                    if (delta === undefined) return
                    e.preventDefault()
                    onOverlayTimeChange(o.id, shiftRange(o.startTime, o.endTime, delta, duration), true)
                  }}
                  className={`absolute inset-y-0.5 flex cursor-grab touch-none items-center overflow-hidden rounded px-2 text-[11px] font-medium text-black active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                    selected ? 'bg-gold ring-2 ring-white' : o.kind === 'text' ? 'bg-gold/75' : 'bg-sky-300/80'
                  }`}
                  style={{ left: `${pct(o.startTime)}%`, width: `${Math.max(1.5, pct(o.endTime) - pct(o.startTime))}%` }}
                >
                  <span className="truncate">{o.content}</span>
                </button>
                {selected && (
                  <>
                    <RangeHandle
                      label={`${name} starts`}
                      side="start"
                      value={o.startTime}
                      min={0}
                      max={o.endTime - MIN_RANGE_GAP}
                      pct={pct(o.startTime)}
                      timeAt={timeAt}
                      onGestureStart={onGestureStart}
                      onGestureEnd={onGestureEnd}
                      onChange={(start, record) => onOverlayTimeChange(o.id, { start, end: o.endTime }, record)}
                    />
                    <RangeHandle
                      label={`${name} ends`}
                      side="end"
                      value={o.endTime}
                      min={o.startTime + MIN_RANGE_GAP}
                      max={duration}
                      pct={pct(o.endTime)}
                      timeAt={timeAt}
                      onGestureStart={onGestureStart}
                      onGestureEnd={onGestureEnd}
                      onChange={(value, record) => onOverlayTimeChange(o.id, { start: o.startTime, end: value }, record)}
                    />
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex justify-between font-mono text-[10px] text-white/60" aria-hidden="true">
        <span>{formatTime(trimStart)}</span>
        <span>{formatTime(end)}</span>
      </div>
    </div>
  )
}
