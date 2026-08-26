// SCORM/xAPI packages (see courseContent.js's uploadZipEntries) ship their
// own html/js/css/json/xml/svg alongside binary assets, all served
// same-origin under /course-content/*. This used to be a plain vercel.json
// `routes` proxy straight to Supabase Storage's public object endpoint.
// Supabase deliberately overrides Content-Type to text/plain for the
// "renderable as a page" extensions below -- an anti-phishing measure with
// no upload-time or query-string opt-out (see
// https://github.com/orgs/supabase/discussions/39110) -- which is why a
// SCORM/xAPI launch page showed as raw markup instead of rendering: the
// iframe got the right bytes back with the wrong header.
//
// This middleware now owns the whole /course-content/* proxy itself (the old
// vercel.json `routes` rule was removed) -- Vercel silently leaves Routing
// Middleware unwired when a legacy `routes` array is also present, confirmed
// by inspecting a deployment's build manifest ("middleware": [] even though
// the middleware function itself built fine), so the two can't coexist here.
// Every extension below gets its Content-Type forced; everything else
// (video, images, generic downloads) passes through with Supabase's own
// headers as-is, including Range/206 passthrough so video seeking still
// works.
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

export const config = {
  matcher: '/course-content/:path*',
}

export default async function middleware(request) {
  const url = new URL(request.url)
  const objectPath = url.pathname.replace(/^\/course-content\//, '')
  const upstreamUrl = `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/course-content/${objectPath}`

  const range = request.headers.get('range')
  const upstream = await fetch(upstreamUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: range ? { range } : undefined,
  })
  if (!upstream.ok) return new Response(null, { status: upstream.status })

  const headers = new Headers(upstream.headers)
  const ext = url.pathname.split('.').pop()?.toLowerCase()
  const overrideType = OVERRIDE_CONTENT_TYPES[ext]
  if (overrideType) {
    headers.set('content-type', overrideType)
    // Supabase's override sometimes pairs with a forced attachment
    // disposition -- drop it so the file still renders inline in the iframe
    // rather than triggering a download.
    headers.delete('content-disposition')
  }
  return new Response(upstream.body, { status: upstream.status, headers })
}
