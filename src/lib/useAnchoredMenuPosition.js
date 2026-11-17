import { useLayoutEffect, useState } from 'react'

const VIEWPORT_MARGIN = 8

// Positions an open dropdown menu under its trigger button with
// position: fixed, clamped so it always stays fully inside the viewport --
// and, being fixed, it isn't clipped by a horizontally scrolling parent
// (e.g. a tab bar that scrolls sideways on a phone). `align` is which edge
// of the button the menu lines up with when there's room. Closes (via
// onClose) on scroll or resize rather than drifting away from the button.
export default function useAnchoredMenuPosition({ open, buttonRef, menuRef, align = 'left', onClose }) {
  const [style, setStyle] = useState({ position: 'fixed', visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return undefined
    const button = buttonRef.current
    const menu = menuRef.current
    if (!button || !menu) return undefined

    const rect = button.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const menuWidth = Math.min(menu.offsetWidth, viewportWidth - VIEWPORT_MARGIN * 2)
    const preferredLeft = align === 'right' ? rect.right - menuWidth : rect.left
    const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, viewportWidth - menuWidth - VIEWPORT_MARGIN))
    setStyle({ position: 'fixed', top: rect.bottom + 4, left, maxWidth: viewportWidth - VIEWPORT_MARGIN * 2 })

    function handleMove(event) {
      // Scrolling inside the menu itself is fine.
      if (event.type === 'scroll' && menu.contains(event.target)) return
      onClose?.()
    }
    window.addEventListener('resize', handleMove)
    window.addEventListener('scroll', handleMove, true)
    return () => {
      window.removeEventListener('resize', handleMove)
      window.removeEventListener('scroll', handleMove, true)
    }
    // onClose is re-created by callers each render; position only depends on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align])

  return open ? style : { position: 'fixed', visibility: 'hidden' }
}
