import { lazy } from 'react'

const RELOAD_KEY = 'learnscope-chunk-reload'

// A tab left open across a deploy still references the previous build's
// hashed chunk names, which no longer exist -- the import then fails the
// first time the learner opens a page they hadn't visited yet. Reloading once
// picks up the new build; the session flag stops a genuinely missing chunk
// from looping, and falls through to ErrorBoundary instead.
export function lazyRoute(load, storage = globalThis.sessionStorage, reload = () => window.location.reload()) {
  return lazy(async () => {
    try {
      const module = await load()
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
}
