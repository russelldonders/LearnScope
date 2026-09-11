import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Touch dragging is wired through raw touchstart/touchmove/touchend
// listeners rather than the Pointer Events API. Pointer Events looked
// right in every browser we could test (including Chromium under touch
// emulation) but iOS Safari's setPointerCapture/hasPointerCapture is a
// known-unreliable combo for nested touch targets -- it can silently
// no-op, so handlePointerMove/finishPointerDrag's hasPointerCapture guard
// never passes and the drag never "picks up". Touch events plus a
// manually attached non-passive listener (JSX touch handlers are passive
// by default in React and can't preventDefault) is the standard
// workaround. Mouse still goes through native HTML5 draggable/onDragStart
// below, untouched.
export function DragHandle({
  label,
  dragLabel,
  disabled,
  onDragStart,
  onDragEnd,
  onKeyDown,
  onPointerDragStart,
  onPointerDragMove,
  onPointerDragEnd,
}) {
  const buttonRef = useRef(null)
  const draggingRef = useRef(false)
  // Touch dragging had no visual feedback at all -- the only cue was the
  // drop target lighting up once you were already over it, so a drag in
  // progress was easy to miss. This floating label follows the finger the
  // same way a native HTML5 drag image would for mouse (which gets one for
  // free from the browser); touch never did, since we drive it ourselves.
  const [ghost, setGhost] = useState(null)
  // The caller holds its dragged-item/drop-target state itself, so every
  // touchmove-driven setState re-renders the whole list and hands this
  // component fresh onPointerDrag* closures on every one of those renders.
  // Keeping those in a ref -- instead of the effect's dependency array --
  // means the touch listeners are attached once and read the latest
  // callback rather than being torn down and re-attached mid-gesture,
  // which on iOS Safari was dropping the in-flight touch and making items
  // never pick up.
  const callbacksRef = useRef({})
  callbacksRef.current = { onPointerDragStart, onPointerDragMove, onPointerDragEnd, onDragEnd }

  useEffect(() => {
    const button = buttonRef.current
    if (!button || disabled) return

    function handleTouchStart(event) {
      draggingRef.current = true
      const touch = event.touches[0]
      if (touch) setGhost({ x: touch.clientX, y: touch.clientY })
      callbacksRef.current.onPointerDragStart?.(event)
    }

    function handleTouchMove(event) {
      if (!draggingRef.current) return
      event.preventDefault()
      const touch = event.touches[0]
      if (!touch) return
      if (touch.clientY < 72) window.scrollBy({ top: -16, behavior: 'auto' })
      else if (touch.clientY > window.innerHeight - 72) window.scrollBy({ top: 16, behavior: 'auto' })
      setGhost({ x: touch.clientX, y: touch.clientY })
      callbacksRef.current.onPointerDragMove?.({ clientX: touch.clientX, clientY: touch.clientY })
    }

    function handleTouchEnd(event) {
      if (!draggingRef.current) return
      draggingRef.current = false
      setGhost(null)
      const touch = event.changedTouches[0]
      callbacksRef.current.onPointerDragEnd?.(touch ? { clientX: touch.clientX, clientY: touch.clientY } : { clientX: -1, clientY: -1 })
    }

    function handleTouchCancel() {
      if (!draggingRef.current) return
      draggingRef.current = false
      setGhost(null)
      callbacksRef.current.onDragEnd?.()
    }

    button.addEventListener('touchstart', handleTouchStart, { passive: true })
    button.addEventListener('touchmove', handleTouchMove, { passive: false })
    button.addEventListener('touchend', handleTouchEnd, { passive: true })
    button.addEventListener('touchcancel', handleTouchCancel, { passive: true })
    return () => {
      button.removeEventListener('touchstart', handleTouchStart)
      button.removeEventListener('touchmove', handleTouchMove)
      button.removeEventListener('touchend', handleTouchEnd)
      button.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [disabled])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        draggable={!disabled}
        disabled={disabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onKeyDown={onKeyDown}
        aria-label={`${label}. Drag to reorder, or use the arrow keys.`}
        title="Drag to reorder"
        className="inline-flex h-11 w-11 md:h-7 md:w-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-secondary hover:bg-paper hover:text-ink focus:outline-none focus:ring-2 focus:ring-moss active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="5" r="1.6" /><circle cx="15" cy="5" r="1.6" />
          <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="19" r="1.6" /><circle cx="15" cy="19" r="1.6" />
        </svg>
      </button>
      {ghost &&
        dragLabel &&
        createPortal(
          // Portalled to <body> rather than rendered inline: this used to sit
          // in the DOM as a descendant of the dragged row itself, so when it
          // visually overlapped a *different* row under the finger, some drop-
          // target lookups could resolve back to the dragged row's own
          // ancestors instead of whatever was actually underneath. Detaching
          // it removes that possibility entirely.
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-md bg-ink text-paper text-xs font-medium px-2.5 py-1.5 shadow-lg"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {dragLabel}
          </div>,
          document.body
        )}
    </>
  )
}
