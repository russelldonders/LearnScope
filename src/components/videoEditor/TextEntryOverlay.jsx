import { useState } from 'react'
import AccessibleDialog from '../AccessibleDialog'
import { OVERLAY_SCALE_MAX, OVERLAY_SCALE_MIN, OVERLAY_SIZE_PX, TEXT_BACKGROUND_PRESETS, TEXT_COLOR_PRESETS } from '../../lib/videoEdit'

// Typing a caption the story-app way: the video dims, the text is typed
// big in the middle exactly as it will look, the size slider runs up the
// side and the colours sit in a row underneath. Done (or Escape) places it;
// leaving it empty removes it.
export default function TextEntryOverlay({ overlay, onDone }) {
  const [draft, setDraft] = useState(overlay)
  const [pillColor, setPillColor] = useState(overlay.background ?? TEXT_BACKGROUND_PRESETS[0])
  const scale = draft.scale ?? 1

  function finish() {
    onDone({ ...draft, content: draft.content.replace(/\s+$/, '') })
  }

  // Cycles: no pill -> pill in the text's opposite colour -> no pill.
  function togglePill() {
    setDraft((d) => ({ ...d, background: d.background ? null : pillColor }))
  }

  function chooseColor(color) {
    if (draft.background) {
      setPillColor(color)
      setDraft((d) => ({ ...d, background: color, color: color === '#ffffff' || color === '#fde047' ? '#000000' : '#ffffff' }))
    } else {
      setDraft((d) => ({ ...d, color }))
    }
  }

  const palette = draft.background ? TEXT_BACKGROUND_PRESETS : TEXT_COLOR_PRESETS
  const activeColor = draft.background ? draft.background : draft.color

  return (
    <AccessibleDialog
      label="Type your text"
      onClose={finish}
      closeOnBackdrop={false}
      overlayClassName="p-0! bg-black/70! backdrop-blur-sm"
      panelClassName="relative flex h-full w-full flex-col text-white focus:outline-none"
    >
      <div className="flex items-center justify-between gap-2 p-3 sm:p-4">
        <button
          type="button"
          onClick={togglePill}
          aria-pressed={Boolean(draft.background)}
          aria-label="Background behind text"
          className={`flex h-11 w-11 items-center justify-center rounded-full border text-lg font-bold transition-transform active:scale-90 ${
            draft.background ? 'border-white bg-white text-black' : 'border-white/60 text-white'
          }`}
        >
          A
        </button>
        <button
          type="button"
          onClick={finish}
          className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-black transition-transform active:scale-95"
        >
          Done
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14">
        <label className="absolute left-3 top-1/2 flex h-56 -translate-y-1/2 flex-col items-center gap-2 text-[10px] text-white/70">
          <span className="sr-only">Text size</span>
          <input
            type="range"
            min={OVERLAY_SCALE_MIN}
            max={OVERLAY_SCALE_MAX}
            step={0.05}
            value={scale}
            onChange={(e) => setDraft((d) => ({ ...d, scale: Number(e.target.value) }))}
            className="h-48 w-6 accent-white [writing-mode:vertical-lr] [direction:rtl]"
          />
        </label>

        <textarea
          data-dialog-initial-focus
          aria-label="Overlay text"
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          onFocus={(e) => e.currentTarget.select()}
          rows={Math.max(1, draft.content.split('\n').length)}
          className={`max-w-full resize-none overflow-hidden text-center font-bold leading-snug caret-white focus:outline-none [field-sizing:content] ${
            draft.background ? '' : 'bg-transparent [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]'
          }`}
          style={{
            color: draft.color,
            fontSize: (OVERLAY_SIZE_PX[draft.size] ?? OVERLAY_SIZE_PX.medium) * Math.min(scale, 2.5),
            backgroundColor: draft.background || undefined,
            padding: draft.background ? '0.25em 0.6em' : '0.1em',
            borderRadius: draft.background ? '0.6em' : undefined,
            minWidth: '3ch',
          }}
        />
      </div>

      <div className="flex justify-center gap-2.5 overflow-x-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3" role="group" aria-label={draft.background ? 'Background colour' : 'Text colour'}>
        {palette.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => chooseColor(color)}
            aria-pressed={activeColor?.toLowerCase() === color}
            aria-label={color}
            className={`h-8 w-8 shrink-0 rounded-full border-2 transition-transform active:scale-90 ${
              activeColor?.toLowerCase() === color ? 'scale-110 border-white' : 'border-white/50'
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </AccessibleDialog>
  )
}
