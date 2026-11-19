// A dropped connection (a phone switching networks, Safari resuming a tab from
// the background) fails a request outright -- "TypeError: Load failed" in
// Safari, "Failed to fetch" in Chrome -- though trying again a moment later
// usually works. Only reads are retried: a write that failed this way may
// still have reached the server, so repeating it could save it twice.
//
// Reads are GET/HEAD requests (every table select) and calls to database
// functions named list_* or count_*, which only ever read.

const RETRY_DELAYS_MS = [300, 1000]

function requestMethod(input, init) {
  return (init?.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase()
}

function requestUrl(input) {
  return typeof input === 'string' ? input : input?.url ?? String(input)
}

export function isRetryableRead(input, init) {
  const method = requestMethod(input, init)
  if (method === 'GET' || method === 'HEAD') return true
  if (method !== 'POST') return false
  return /\/rest\/v1\/rpc\/(list|count)_[a-z0-9_]+(\?|$)/i.test(requestUrl(input))
}

// The browser's own network failure, not an HTTP error response (those come
// back as a Response) and not a request the app cancelled on purpose.
export function isNetworkFailure(error) {
  return error instanceof TypeError && error.name !== 'AbortError'
}

export async function fetchRetryingReads(doFetch, input, init, { delays = RETRY_DELAYS_MS, wait = defaultWait } = {}) {
  const retryable = isRetryableRead(input, init)
  for (let attempt = 0; ; attempt++) {
    try {
      return await doFetch(input, init)
    } catch (error) {
      if (!retryable || !isNetworkFailure(error) || attempt >= delays.length || init?.signal?.aborted) throw error
      await wait(delays[attempt])
    }
  }
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
