import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

// Once someone is signed in and the page in front of them has settled, fetches
// the code for the pages they move between most, one after another, in the
// background. Without it the first tap on, say, a goal's skill keeps Home on
// screen while the skill page downloads -- seconds on a phone, with nothing to
// show that anything is happening.
export default function PreloadPages({ pages }) {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return undefined
    let cancelled = false
    const whenIdle = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 1500))
    const cancelIdle = globalThis.cancelIdleCallback ?? clearTimeout
    const handle = whenIdle(async () => {
      for (const page of pages) {
        if (cancelled) return
        await page.preload?.()
      }
    })
    return () => {
      cancelled = true
      cancelIdle(handle)
    }
  }, [user, pages])

  return null
}
