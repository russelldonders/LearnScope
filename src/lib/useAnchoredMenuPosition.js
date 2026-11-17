import { useLayoutEffect, useState } from 'react'

const VIEWPORT_MARGIN = 8
const HIDDEN = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }

// Positions an open dropdown menu under its trigger button with
// position: fixed, clamped so it always stays fully inside the viewport.
// Callers render the menu in a portal on document.body, so a scrolling or
// masked parent (e.g. the sideways-scrolling, edge-faded section bar on a
// phone) can't clip or hide it. Follows the button when the page or a parent
// scrolls, and on resize, rather than closing. `align` is which edge of the
// button the menu lines up with when there's room.
export default function useAnchoredMenuPosition({ open, buttonRef, menuRef, align = 'left' }) {
  const [style, setStyle] = useState(HIDDEN)

  useLayoutEffect(() => {
    if (!open) return undefined
    function place() {
      const button = buttonRef.current
      const menu = menuRef.current
      if (!button || !menu) return
      const rect = button.getBoundingClientRect()
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const menuWidth = Math.min(menu.offsetWidth, viewportWidth - VIEWPORT_MARGIN * 2)
      const preferredLeft = align === 'right' ? rect.right - menuWidth : rect.left
      const left = Math.max(VIEWPORT_MARGIN, Math.min(preferredLeft, viewportWidth - menuWidth - VIEWPORT_MARGIN))
      setStyle({ position: 'fixed', top: rect.bottom + 4, left, maxWidth: viewportWidth - VIEWPORT_MARGIN * 2 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align, buttonRef, menuRef])

  return open ? style : HIDDEN
}
