// AppHeader is rendered by each page, so it remounts on every navigation.
// Its two reads (the learner's name/avatar and their organisations' names/
// logos) are cached here for a short time so moving between pages doesn't
// refetch them, and so the header renders them immediately instead of
// popping in. Anything that changes those values calls invalidateHeaderCache()
// so edits still show straight away; the TTL is a backstop for changes made
// elsewhere (another tab, another admin renaming an organisation).
const TTL_MS = 60 * 1000
const entries = new Map()

// Returns the cached value for `key` if it's still fresh, else undefined.
export function peekHeaderCache(key, now = Date.now()) {
  const entry = entries.get(key)
  return entry && entry.value !== undefined && now - entry.at < TTL_MS ? entry.value : undefined
}

// Resolves `load()` at most once per key per TTL, sharing an in-flight
// request between headers that mount at the same time. A failed load isn't
// cached, so the next mount simply tries again.
export function loadHeaderCache(key, load, now = Date.now()) {
  const entry = entries.get(key)
  if (entry && now - entry.at < TTL_MS) return entry.promise
  const promise = load().then(
    (value) => {
      const current = entries.get(key)
      if (current?.promise === promise) current.value = value
      return value
    },
    (error) => {
      if (entries.get(key)?.promise === promise) entries.delete(key)
      throw error
    }
  )
  entries.set(key, { at: now, promise, value: undefined })
  return promise
}

export function invalidateHeaderCache() {
  entries.clear()
}
