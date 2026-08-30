import { useEffect, useState } from 'react'

// Regex-based UA sniffing rather than viewport width -- a narrow desktop
// window shouldn't be treated as a phone, and a tablet/phone in landscape
// shouldn't lose its mobile affordances just because the viewport happens
// to be wide at a given moment.
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

// The opposite concern from isMobileDevice above: this tracks the
// *viewport* against Tailwind's md breakpoint (768px), for layouts that
// switch structure at md regardless of device type -- e.g. a course
// player showing content inline in its outline below md vs. in a side
// pane at md+. Needs to be a real, reactive check (not a CSS-only
// show/hide) whenever whichever layout isn't visible must not be mounted
// at all -- a SCORM/xAPI player can fire its own launch/tracking calls
// just from mounting, so a display:none copy sitting in the DOM would
// double those up.
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  )
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')
    const handleChange = (event) => setIsDesktop(event.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])
  return isDesktop
}
