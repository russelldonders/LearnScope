import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

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
    const initialFocus = dialog?.querySelector('[data-dialog-initial-focus]') ?? dialog?.querySelector(FOCUSABLE)
    ;(initialFocus ?? dialog)?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
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
