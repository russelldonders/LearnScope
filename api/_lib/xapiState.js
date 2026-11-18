// The xAPI State API (/activities/state) for packages launched from
// LearnScope (0316): documents a package saves -- where the learner was,
// what they'd earned -- and reads back on its next launch.
//
// Keyed by the learner and resource of the launch session that authorised
// the request, never by the package's own "agent" parameter: a package can
// only read and write its own learner's state for itself.
//
// A stored document is untrusted package content served from LearnScope's
// own origin, so it is never served as anything a browser would render: as
// JSON when it is JSON, otherwise as an opaque download, sandboxed either
// way (whatever type the package said it was).

// Bookmarks and progress, not files; xapi_activity_state's trigger also caps
// each learner's documents per package in number and total size.
export const MAX_DOCUMENT_BYTES = 256 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

function scope(query, session, { activityId, registration }) {
  let q = query.eq('user_id', session.user_id).eq('activity_id', activityId)
  q = session.skill_resource_id ? q.eq('skill_resource_id', session.skill_resource_id) : q.eq('resource_id', session.resource_id)
  return registration ? q.eq('registration', registration) : q.is('registration', null)
}

// The request body as text, whatever form the runtime parsed it into.
export function bodyText(body) {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  return JSON.stringify(body)
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function asObject(text) {
  const parsed = parseJson(text)
  return parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value) ? parsed.value : null
}

// Served as data only: never rendered, run or sniffed as a page.
export function sendDocument(res, document, updatedAt) {
  res.setHeader('Content-Type', parseJson(document).ok ? 'application/json; charset=utf-8' : 'application/octet-stream')
  res.setHeader('Content-Disposition', 'attachment')
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (updatedAt) res.setHeader('Last-Modified', new Date(updatedAt).toUTCString())
  res.status(200).send(document)
}

function params(req, res) {
  const activityId = typeof req.query.activityId === 'string' ? req.query.activityId : ''
  if (!activityId || activityId.length > 2000) {
    res.status(400).json({ error: 'activityId is required.' })
    return null
  }
  const registration = typeof req.query.registration === 'string' && req.query.registration ? req.query.registration : null
  if (registration && !UUID.test(registration)) {
    res.status(400).json({ error: 'registration must be a UUID.' })
    return null
  }
  const stateId = typeof req.query.stateId === 'string' && req.query.stateId ? req.query.stateId : null
  if (stateId && stateId.length > 500) {
    res.status(400).json({ error: 'stateId is too long.' })
    return null
  }
  return { activityId, registration, stateId }
}

export async function handleState(admin, session, req, res) {
  const p = params(req, res)
  if (!p) return
  const table = () => admin.from('xapi_activity_state')

  if (req.method === 'GET') {
    if (p.stateId) {
      const { data, error } = await scope(table().select('document, updated_at'), session, p)
        .eq('state_id', p.stateId)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        res.status(404).end()
        return
      }
      sendDocument(res, data.document, data.updated_at)
      return
    }
    let query = scope(table().select('state_id'), session, p)
    if (typeof req.query.since === 'string' && !Number.isNaN(Date.parse(req.query.since))) {
      query = query.gt('updated_at', new Date(req.query.since).toISOString())
    }
    const { data, error } = await query
    if (error) throw error
    res.status(200).json((data ?? []).map((row) => row.state_id))
    return
  }

  if (req.method === 'DELETE') {
    let query = scope(table().delete(), session, p)
    if (p.stateId) query = query.eq('state_id', p.stateId)
    const { error } = await query
    if (error) throw error
    res.status(204).end()
    return
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    if (!p.stateId) {
      res.status(400).json({ error: 'stateId is required.' })
      return
    }
    let document = bodyText(req.body)
    if (Buffer.byteLength(document, 'utf8') > MAX_DOCUMENT_BYTES) {
      res.status(413).json({ error: 'State document too large.' })
      return
    }
    const findExisting = () => scope(table().select('id, document'), session, p).eq('state_id', p.stateId).maybeSingle()
    const { data: existing, error: readError } = await findExisting()
    if (readError) throw readError

    // POST merges a JSON object into a stored JSON object (xAPI 1.0.3,
    // "JSON Procedure with Requirements"); otherwise it replaces, like PUT.
    if (req.method === 'POST' && existing) {
      const stored = asObject(existing.document)
      const incoming = asObject(document)
      if (stored && incoming) document = JSON.stringify({ ...stored, ...incoming })
    }

    const update = (id) => table().update({ document, updated_at: new Date().toISOString() }).eq('id', id)
    let { error } = existing
      ? await update(existing.id)
      : await table().insert({
        user_id: session.user_id,
        [session.skill_resource_id ? 'skill_resource_id' : 'resource_id']: session.skill_resource_id ?? session.resource_id,
        activity_id: p.activityId,
        registration: p.registration,
        state_id: p.stateId,
        document,
      })
    // Two first writes at once: the second becomes an update.
    if (error?.code === UNIQUE_VIOLATION) {
      const { data: raced, error: raceError } = await findExisting()
      if (raceError) throw raceError
      ;({ error } = raced ? await update(raced.id) : { error })
    }
    if (error?.code === CHECK_VIOLATION) {
      res.status(413).json({ error: 'Saved state for this package is over its limit.' })
      return
    }
    if (error) throw error
    res.status(204).end()
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
