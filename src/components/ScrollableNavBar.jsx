import { useEffect, useRef, useState } from 'react'

// One-row navigation bar shared by the organisation workspace and the
// platform console. Stays on a single line at every screen size so every
// item sits on the same underline; on a phone the whole row scrolls sideways
// (scrollbar hidden), and whichever end has more items out of view fades out
// rather than cutting an item off mid-word.
//
// The underline is an inset shadow rather than a border so a selected item's
// own border-b-2 can sit on top of it inside the scrolling row (which would
// clip the usual -mb-px overlap). Dropdowns inside it (DropdownNavMenu) render
// in a portal, so neither the scrolling nor the fade mask can hide them.
// Children use `shrink-0` and `border-b-2` (no -mb-px).
export default function ScrollableNavBar({ children, className = '', ...props }) {
  const ref = useRef(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  useEffect(() => {
    const bar = ref.current
    if (!bar) return undefined
    function update() {
      const start = bar.scrollLeft > 1
      const end = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1
      setOverflow((current) => (current.start === start && current.end === end ? current : { start, end }))
    }
    update()
    bar.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      bar.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  })

  const mask = overflow.start || overflow.end
    ? `linear-gradient(to right, ${overflow.start ? 'transparent, black 2rem' : 'black'}, ${overflow.end ? 'black calc(100% - 2rem), transparent' : 'black'})`
    : undefined

  return (
    <div
      ref={ref}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={`flex items-end gap-x-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_-1px_0_var(--color-hairline)] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

