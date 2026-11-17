import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

// Text "Settings" dropdown in the organisation workspace's section bar,
// styled like the "Learning content" section menu, replacing the former cog
// button + intermediate settings dialog. Each item either opens its own
// settings dialog (onSelect) or goes to its own page (to). Not a section tab
// -- choosing an item never changes the selected section -- so it's a plain
// menu button (aria-haspopup="menu") outside the section tablist.
// items: [{ key, label, description?, onSelect? , to? }]. `active` underlines
// it like a selected tab while one of its pages (e.g. Linked providers) is open.
export default function EmployerSettingsMenu({ items, active = false }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const itemRefs = useRef([])

  useEffect(() => {
    if (!open) return undefined
    itemRefs.current[0]?.focus()
    function handleOutside(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
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
    const focusAt = (i) => elements[(i + elements.length) % elements.length]?.focus()
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
      close({ restoreFocus: false })
    }
  }

  if (items.length === 0) return null

  const itemClass = 'block w-full px-4 py-2.5 text-left hover:bg-paper focus:bg-paper focus:outline-none'

  return (
    <div className="relative" ref={containerRef}>
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
        className={`flex items-center gap-1 text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${
          active ? 'border-moss text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'
        }`}
      >
        Settings
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Settings"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] bg-card border border-hairline rounded-md shadow-lg py-1"
        >
          {items.map((item, index) => {
            const content = (
              <>
                <span className="block text-sm font-medium text-ink">{item.label}</span>
                {item.description && <span className="mt-0.5 block text-xs text-secondary">{item.description}</span>}
              </>
            )
            return item.to ? (
              <Link
                key={item.key}
                ref={(el) => { itemRefs.current[index] = el }}
                role="menuitem"
                to={item.to}
                onClick={() => setOpen(false)}
                className={itemClass}
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
        </div>
      )}
    </div>
  )
}
