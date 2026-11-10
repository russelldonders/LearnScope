import { lazy } from 'react'

const RELOAD_KEY = 'learnscope-chunk-reload'

// A tab left open across a deploy still references the previous build's
// hashed chunk names, which no longer exist -- the import then fails the
// first time the learner opens a page they hadn't visited yet. Reloading once
// picks up the new build; the session flag stops a genuinely missing chunk
// from looping, and falls through to ErrorBoundary instead.
//
// The returned component also has preload(): it fetches the page's code ahead
// of time (see PreloadPages), so opening it later doesn't wait on the network
// with the previous page still showing. A failed preload is forgotten, and
// opening the page then tries again as normal.
export function lazyRoute(load, storage = globalThis.sessionStorage, reload = () => window.location.reload()) {
  let pending = null
  const loadOnce = () => {
    if (!pending) {
      pending = load().catch((error) => {
        pending = null
        throw error
      })
    }
    return pending
  }

  const component = lazy(async () => {
    try {
      const module = await loadOnce()
      try { storage?.removeItem(RELOAD_KEY) } catch { /* storage unavailable */ }
      return module
    } catch (error) {
      let alreadyReloaded = true
      try {
        alreadyReloaded = storage?.getItem(RELOAD_KEY) === '1'
        if (!alreadyReloaded) storage?.setItem(RELOAD_KEY, '1')
      } catch { /* storage unavailable -- don't risk a reload loop */ }
      if (alreadyReloaded) throw error
      reload()
      return new Promise(() => {})
    }
  })
  component.preload = () => loadOnce().then(() => undefined, () => undefined)
  return component
}
