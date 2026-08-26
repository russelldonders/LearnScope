import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// A minimal Learning Record Store for uploaded xAPI/Tin Can packages (see
// 0079_xapi_resources.sql). This is NOT a spec-conformant LRS -- it
// implements just enough of the xAPI 1.0 surface for typical generated
// packages to launch and record statements: the "about" handshake and the
// Statements resource (GET/POST/PUT). The State/Agent-Profile/Activity-
// Profile APIs are deliberately not implemented; a package that depends on
// them for bookmarking will degrade (lose that bookmark) rather than fail
// outright, since real LRS clients treat those as best-effort.
//
// One function file handles every /api/xapi/* route (Vercel catch-all) --
// this project sits at the Hobby plan's 12-function cap (see
// api/admin/actions.js and api/send-email.js), so this reuses the same
// "one file, many routes/actions" shape rather than one file per xAPI
// resource.
//
// This file briefly also served course-content bytes (a proxy for
// SCORM/xAPI package assets) to work around the same function-count cap.
// That didn't work either: Vercel's zero-config Vite routing serves the SPA
// shell instead of a function for "navigate"-type requests (which is
// exactly how an iframe's src load behaves) even when the path matches a
// real function route -- fetch()/XHR calls to this same file's other routes
// are unaffected, which is why xAPI statements never had this problem. The
// course-content proxy is back to being a plain vercel.json `routes`
// external-URL proxy (see courseContent.js's publicUrlFor), which isn't
// subject to that navigate-vs-fetch routing distinction; vercel.json's
// `transforms` on those routes force the right Content-Type instead (JSON
// has no comment syntax, so the reasoning lives here and in
// courseContent.js).
//
// Auth is per-launch, not per-user-session: a package is launched with a
// short-lived xapi_launch_sessions token embedded in its own launch URL
// (Basic auth, per the ADL Launch spec), not a Supabase JWT -- the browser
// tab has no ambient session credential to give it (and shouldn't; see
// XapiPlayer.jsx's sandboxing comment). This function looks the token up
// via the service role, since RLS has nothing to authenticate the request
// against.

const XAPI_VERSION = '1.0.3'
// Bounds on statement writes -- a launch token is short-lived (0080's
// expiry-bounded check constraint) but still shouldn't be able to write
// unbounded rows/storage for however long it's valid.
const MAX_BATCH_SIZE = 50
const MAX_STATEMENT_BYTES = 50_000
const MAX_STATEMENTS_PER_SESSION = 1000

function setCorsHeaders(res) {
  // The package runs in a sandboxed iframe with no allow-same-origin (see
  // XapiPlayer.jsx), so it has an opaque ("null") origin -- an explicit
  // origin allowlist can never match that, and there's no cookie/session
  // credential in play for a wildcard to put at risk (auth is the embedded
  // launch token, checked below), so `*` is the only workable and still
  // safe choice here.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Experience-API-Version')
}

async function resolveSession(req, res) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Basic ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header.' })
    return null
  }

  let token
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8')
    token = decoded.split(':')[0]
  } catch {
    res.status(401).json({ error: 'Malformed Authorization header.' })
    return null
  }
  if (!token) {
    res.status(401).json({ error: 'Malformed Authorization header.' })
    return null
  }

  const admin = supabaseAdmin()
  const { data: session, error } = await admin
    .from('xapi_launch_sessions')
    .select('id, resource_id, user_id, course_id, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error

  if (!session || new Date(session.expires_at) < new Date()) {
    res.status(401).json({ error: 'Launch session not found or expired.' })
    return null
  }

  return { admin, session }
}

async function handleStatements(req, res) {
  const resolved = await resolveSession(req, res)
  if (!resolved) return
  const { admin, session } = resolved

  if (req.method === 'GET') {
    const registration = req.query.registration ?? session.id
    const { data, error } = await admin
      .from('xapi_statements')
      .select('statement')
      .eq('resource_id', session.resource_id)
      .eq('user_id', session.user_id)
      .order('recorded_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const statements = (data ?? [])
      .map((row) => row.statement)
      .filter((s) => !registration || s?.context?.registration === registration)
    res.status(200).json({ statements, more: '' })
    return
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const body = req.body
    const incoming = Array.isArray(body) ? body : [body]
    if (incoming.length === 0 || incoming.some((s) => !s || typeof s !== 'object')) {
      res.status(400).json({ error: 'Invalid statement payload.' })
      return
    }
    if (incoming.length > MAX_BATCH_SIZE) {
      res.status(400).json({ error: `Too many statements in one request (max ${MAX_BATCH_SIZE}).` })
      return
    }
    if (incoming.some((s) => JSON.stringify(s).length > MAX_STATEMENT_BYTES)) {
      res.status(400).json({ error: 'Statement too large.' })
      return
    }

    // Scoped by resource+user rather than just this one session/
    // registration -- a launch session is short-lived (0080's expiry-
    // bounded check constraint), but relaunching the same resource creates
    // a fresh session, so capping per-session alone wouldn't actually bound
    // total writes for one user against one resource.
    const { count, error: countError } = await admin
      .from('xapi_statements')
      .select('id', { count: 'exact', head: true })
      .eq('resource_id', session.resource_id)
      .eq('user_id', session.user_id)
    if (countError) throw countError
    if ((count ?? 0) + incoming.length > MAX_STATEMENTS_PER_SESSION) {
      res.status(429).json({ error: 'Too many statements recorded for this launch.' })
      return
    }

    // PUT is idempotent-by-id: the client supplies the id (query param or
    // body), and a single statement only. POST lets the LRS assign ids and
    // accepts a batch array -- the two request shapes the xAPI spec defines
    // for this resource. Setting the row's own primary key to the same id
    // (rather than a separately-generated one) and upserting on it makes a
    // client's retry-after-timeout genuinely idempotent instead of writing
    // a duplicate row.
    const ids = []
    const rows = incoming.map((statement) => {
      const id = req.method === 'PUT' ? req.query.statementId || statement.id : statement.id || randomUUID()
      const stamped = { ...statement, id }
      ids.push(id)
      return {
        id,
        user_id: session.user_id,
        resource_id: session.resource_id,
        course_id: session.course_id,
        statement: stamped,
        recorded_at: stamped.timestamp ? new Date(stamped.timestamp) : new Date(),
      }
    })

    const { error } = await admin.from('xapi_statements').upsert(rows, { onConflict: 'id' })
    if (error) throw error

    res.status(req.method === 'PUT' ? 204 : 200)
    if (req.method === 'POST') res.json(ids)
    else res.end()
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const path = Array.isArray(req.query.path) ? req.query.path : []
  const resource = path[0]

  try {
    if (resource === 'about') {
      res.status(200).json({ version: [XAPI_VERSION] })
      return
    }
    if (resource === 'statements') {
      await handleStatements(req, res)
      return
    }
    res.status(404).json({ error: 'Not found' })
  } catch (err) {
    console.error(`xapi (${resource}) error:`, err)
    res.status(500).json({ error: 'LRS request failed.' })
  }
}
