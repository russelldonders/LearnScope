import { Readable } from 'node:stream'

// Public GET-only proxy for the course-content storage bucket (see
// courseContent.js's uploadZipEntries/uploadSingleFileResource) -- fetches
// straight from Supabase Storage's public object endpoint and re-serves the
// bytes, same-origin, under /api/course-content/*. SCORM's own
// window.parent.API contract (ScormPlayer.jsx) only works same-origin,
// which is why this exists as a same-origin proxy rather than linking
// straight to Supabase's own storage domain.
//
// This used to be a plain vercel.json `routes` reverse-proxy straight to
// Supabase, no function involved. That broke rendering: Supabase
// deliberately overrides Content-Type to text/plain for html/js/css/json/
// xml/svg served from a public bucket -- an anti-phishing measure with no
// upload-time or query-string opt-out (see
// https://github.com/orgs/supabase/discussions/39110) -- and uploaded
// SCORM/xAPI packages are made of exactly those file types, so their launch
// pages rendered as raw markup instead of executing. A Vercel Routing
// Middleware (root middleware.js) was tried next, but this project's Vite
// build preset never wires root middleware into the routing manifest at all
// (confirmed by inspecting a deployment's build output: the middleware
// function built fine but the manifest's own "middleware" list stayed
// empty regardless of what else was in vercel.json) -- that needs a
// Vite-specific Vercel build plugin this project doesn't have, so a real
// function is the working option. Every extension below gets its
// Content-Type forced; everything else (video, images, generic downloads)
// passes through with Supabase's own headers as-is, including Range/206
// forwarding so video seeking keeps working.
const OVERRIDE_CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
}

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path : []
  if (path.length === 0) {
    res.status(404).end()
    return
  }

  const objectPath = path.map(encodeURIComponent).join('/')
  const upstreamUrl = `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/course-content/${objectPath}`

  const range = req.headers.range
  const upstream = await fetch(upstreamUrl, {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: range ? { range } : undefined,
  })
  if (!upstream.ok) {
    res.status(upstream.status).end()
    return
  }

  // fetch() already transparently decodes any transport encoding, so the
  // upstream's own content-encoding/content-length headers (if present) no
  // longer describe the bytes we're about to send -- forwarding them as-is
  // would make the client try to re-decode (or mis-size) an already-decoded
  // body.
  const hadContentEncoding = upstream.headers.has('content-encoding')
  const headers = Object.fromEntries(upstream.headers)
  delete headers['content-encoding']
  if (hadContentEncoding) delete headers['content-length']

  const ext = path[path.length - 1]?.split('.').pop()?.toLowerCase()
  const overrideType = OVERRIDE_CONTENT_TYPES[ext]
  if (overrideType) {
    headers['content-type'] = overrideType
    // Supabase's override sometimes pairs with a forced attachment
    // disposition -- drop it so the file still renders inline in the
    // iframe rather than triggering a download.
    delete headers['content-disposition']
  }

  res.writeHead(upstream.status, headers)
  if (req.method === 'HEAD' || !upstream.body) {
    res.end()
    return
  }
  Readable.fromWeb(upstream.body).pipe(res)
}
