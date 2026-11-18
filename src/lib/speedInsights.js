// Real-user page performance (Vercel Speed Insights) reports each page's URL.
// LearnScope URLs can carry personal identifiers and secret codes -- user and
// course ids, invite and rating codes, ?org= ids -- so every report is reduced
// to the route's shape before it leaves the browser: no query string, no hash,
// and every id or code replaced by a placeholder.

// Path segments that are always followed by a private code or token (the
// /rate/:code, /recommend/:code, /plan-invite/:code, /shared/:token and
// /validate-request/:requestId routes in App.jsx).
const CODE_PREFIXES = new Set(['rate', 'recommend', 'plan-invite', 'shared', 'validate-request'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A segment that looks like an identifier rather than a fixed route word:
// a UUID, or anything 6+ characters long that contains a digit.
function looksLikeId(segment) {
  return UUID.test(segment) || (segment.length >= 6 && /\d/.test(segment))
}

export function anonymiseRoute(pathname) {
  const segments = pathname.split('/')
  return segments
    .map((segment, index) => {
      if (!segment) return segment
      if (CODE_PREFIXES.has(segments[index - 1])) return ':code'
      return looksLikeId(segment) ? ':id' : segment
    })
    .join('/')
}

export function anonymiseVital(event) {
  try {
    const url = new URL(event.url)
    const route = anonymiseRoute(url.pathname)
    return { ...event, url: `${url.origin}${route}`, route }
  } catch {
    return null
  }
}
