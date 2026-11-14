import { useEffect, useRef } from 'react'

// Tracks every currently-mounted dialog instance so Escape closes only the
// topmost one -- needed now that a dialog can open another on top of itself
// (e.g. a skill picker opened mid-form from within another still-open
// dialog) rather than every mounted dialog reacting to the same keypress.
let openDialogStack = []

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

function isTouchScreen() {
  return Boolean(window.matchMedia?.('(pointer: coarse)').matches)
}

// Whether focusing this element would bring up an on-screen keyboard.
function opensKeyboard(element) {
  if (!element) return false
  if (element.matches('textarea, [contenteditable="true"]')) return true
  return element.matches('input') && !NON_TEXT_INPUTS.has(element.type)
}

export default function AccessibleDialog({
  children,
  label,
  labelledBy,
  describedBy,
  onClose,
  panelClassName = '',
  panelRef,
  overlayClassName = '',
  closeOnBackdrop = true,
}) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const dialog = dialogRef.current
    const instance = {}
    openDialogStack.push(instance)
    // On a phone, focusing a text field brings up the keyboard over the form
    // before the learner has seen it, so the dialog itself takes focus there
    // instead (screen readers still start inside it). A field marked
    // data-dialog-initial-focus is still focused.
    const first = dialog?.querySelector(FOCUSABLE)
    const skipFirst = isTouchScreen() && opensKeyboard(first)
    const initialFocus = dialog?.querySelector('[data-dialog-initial-focus]') ?? (skipFirst ? null : first)
    ;(initialFocus ?? dialog)?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        if (openDialogStack[openDialogStack.length - 1] !== instance) return
        event.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter(
        (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
      )
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      openDialogStack = openDialogStack.filter((i) => i !== instance)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div
      className={`fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 ${overlayClassName}`}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        ref={(element) => {
          dialogRef.current = element
          if (typeof panelRef === 'function') panelRef(element)
          else if (panelRef) panelRef.current = element
        }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  )
}
