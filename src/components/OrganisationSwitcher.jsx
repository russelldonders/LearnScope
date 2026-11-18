import { useEffect, useId, useMemo, useRef, useState } from 'react'

// Show a filter box once the list gets long enough that scanning is slower
// than typing.
const FILTER_THRESHOLD = 6

function initials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

function OrganisationAvatar({ organisation, size = 'md' }) {
  const sizeClass = size === 'sm' ? 'w-7 h-7 text-[11px]' : 'w-9 h-9 text-xs'
  if (organisation.logo_url) {
    return (
      <img loading="lazy" decoding="async"
        src={organisation.logo_url}
        alt=""
        className={`${sizeClass} shrink-0 rounded-md border border-hairline bg-paper object-contain`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} shrink-0 rounded-md border border-moss/40 bg-moss/10 text-moss font-medium flex items-center justify-center`}
    >
      {initials(organisation.name)}
    </span>
  )
}

// Single-select context switcher for which organisation a workspace is
// showing -- one compact button (logo/initials + name) that opens a listbox,
// instead of a tab per organisation that wraps across several lines on a
// phone. Follows the ARIA listbox pattern: arrow keys/Home/End move the
// highlight, Enter/Space chooses, Escape or clicking outside closes, and
// focus returns to the button. onChange(organisationId) is only called for a
// different organisation than the current one.
export default function OrganisationSwitcher({ organisations, selectedId, onChange, label = 'Organisation' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  const listRef = useRef(null)
  const filterRef = useRef(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const labelId = `${baseId}-label`

  const selected = organisations.find((o) => o.id === selectedId) ?? organisations[0]
  const showFilter = organisations.length > FILTER_THRESHOLD
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? organisations.filter((o) => o.name.toLowerCase().includes(q)) : organisations
  }, [organisations, query])

  function openList() {
    setQuery('')
    setActiveIndex(Math.max(0, organisations.findIndex((o) => o.id === selected?.id)))
    setOpen(true)
  }

  function close({ restoreFocus = true } = {}) {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  function choose(organisation) {
    close()
    if (organisation && organisation.id !== selected?.id) onChange?.(organisation.id)
  }

  // Focus the filter (when shown) or the listbox itself as it opens.
  useEffect(() => {
    if (!open) return
    ;(showFilter ? filterRef.current : listRef.current)?.focus()
  }, [open, showFilter])

  useEffect(() => {
    if (!open) return undefined
    function handleOutside(event) {
      if (!containerRef.current?.contains(event.target)) close({ restoreFocus: false })
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open) return
    document.getElementById(`${baseId}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex, baseId])

  function handleListKeyDown(event) {
    const last = visible.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((i) => Math.min(last, i + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(Math.max(0, last))
        break
      case 'Enter':
        event.preventDefault()
        choose(visible[activeIndex])
        break
      case ' ':
        // Space types into the filter; it only chooses from the bare listbox.
        if (event.target === listRef.current) {
          event.preventDefault()
          choose(visible[activeIndex])
        }
        break
      case 'Escape':
        event.preventDefault()
        close()
        break
      case 'Tab':
        close({ restoreFocus: false })
        break
      default:
    }
  }

  function handleButtonKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openList()
    }
  }

  if (!selected) return null
  const activeOptionId = visible[activeIndex] ? `${baseId}-option-${activeIndex}` : undefined

  return (
    <div className="relative w-full sm:w-auto sm:min-w-[18rem] sm:max-w-md" ref={containerRef}>
      <span id={labelId} className="sr-only">{label}</span>
      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${baseId}-current`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={handleButtonKeyDown}
        className="w-full flex items-center gap-3 rounded-lg border border-hairline bg-card px-3 py-2 text-left hover:border-moss/50 focus:outline-none focus:ring-2 focus:ring-moss"
      >
        <OrganisationAvatar organisation={selected} />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] uppercase tracking-wide text-secondary">{label}</span>
          <span id={`${baseId}-current`} className="block truncate text-sm font-medium text-ink">{selected.name}</span>
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`w-4 h-4 shrink-0 text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-lg border border-hairline bg-card shadow-lg overflow-hidden">
          {showFilter && (
            <div className="p-2 border-b border-hairline">
              <input
                ref={filterRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={handleListKeyDown}
                role="combobox"
                aria-label={`Filter ${label.toLowerCase()}s`}
                aria-controls={listId}
                aria-expanded="true"
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                placeholder="Filter…"
                className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            aria-activedescendant={showFilter ? undefined : activeOptionId}
            tabIndex={showFilter ? undefined : -1}
            onKeyDown={showFilter ? undefined : handleListKeyDown}
            className="max-h-72 overflow-y-auto py-1 focus:outline-none"
          >
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-secondary">No matching organisations.</li>
            )}
            {visible.map((organisation, index) => {
              const isSelected = organisation.id === selected.id
              const isActive = index === activeIndex
              return (
                <li
                  key={organisation.id}
                  id={`${baseId}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(organisation)}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${isActive ? 'bg-paper' : ''}`}
                >
                  <OrganisationAvatar organisation={organisation} size="sm" />
                  <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? 'font-medium text-ink' : 'text-ink'}`}>
                    {organisation.name}
                  </span>
                  {isSelected && (
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-4 h-4 shrink-0 text-moss">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
