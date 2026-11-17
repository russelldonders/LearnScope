import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import useAnchoredMenuPosition from '../lib/useAnchoredMenuPosition'

// Text dropdown for a one-row navigation bar (ScrollableNavBar) -- the
// organisation workspace's Settings menu and the platform console's grouped
// sections (People, Content, ...) -- styled like a tab, opening a menu of
// sub-items. Each item either goes to a page (to) or runs an action
// (onSelect, e.g. opening a dialog). The menu renders in a portal on <body>
// (see useAnchoredMenuPosition) so the bar's sideways scrolling and edge-fade
// mask can't clip or hide it.
//   label   -- the button text
//   items   -- [{ key, label, description?, to?, onSelect?, current? }];
//              `current` marks the item for the page being shown
//   active  -- underline the button like a selected tab (one of its pages is open)
//   align   -- which edge of the button the menu lines up with when there's room
export default function DropdownNavMenu({ label, items, active = false, align = 'left', menuWidthClass = 'w-72' }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const itemRefs = useRef([])
  const menuRef = useRef(null)
  const menuStyle = useAnchoredMenuPosition({
    open,
    buttonRef,
    menuRef,
    align,
  })

  useEffect(() => {
    if (!open) return undefined
    itemRefs.current[0]?.focus({ preventScroll: true })
    // The menu is portalled to <body>, so it's outside containerRef in the DOM.
    function handleOutside(event) {
      if (!containerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  function close({ restoreFocus = true } = {}) {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  function handleMenuKeyDown(event) {
    const elements = itemRefs.current.filter(Boolean)
    const index = elements.indexOf(document.activeElement)
    const focusAt = (i) => elements[(i + elements.length) % elements.length]?.focus({ preventScroll: true })
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(elements.length - 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      // Back to the button first, so Tab carries on from there in page order
      // (the portalled menu itself sits at the end of the page).
      close()
    }
  }

  if (items.length === 0) return null

  const itemClass = 'block w-full px-4 py-2.5 text-left hover:bg-paper focus:bg-paper focus:outline-none'

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`flex items-center gap-1 text-sm px-3 py-2 border-b-2 whitespace-nowrap ${
          active ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
        }`}
      >
        {label}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          style={menuStyle}
          className={`z-40 ${menuWidthClass} bg-card border border-hairline rounded-md shadow-lg py-1`}
        >
          {items.map((item, index) => {
            const content = (
              <>
                <span className={`block text-sm text-ink ${item.current ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                {item.description && <span className="mt-0.5 block text-xs text-secondary">{item.description}</span>}
              </>
            )
            return item.to ? (
              <Link
                key={item.key}
                ref={(el) => { itemRefs.current[index] = el }}
                role="menuitem"
                to={item.to}
                aria-current={item.current ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`${itemClass} ${item.current ? 'bg-paper border-l-2 border-moss' : ''}`}
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.key}
                ref={(el) => { itemRefs.current[index] = el }}
                type="button"
                role="menuitem"
                onClick={() => {
                  close({ restoreFocus: false })
                  item.onSelect?.()
                }}
                className={itemClass}
              >
                {content}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}
