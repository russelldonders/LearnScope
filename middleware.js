import { next } from '@vercel/functions'

// SCORM/xAPI packages (see courseContent.js's uploadZipEntries) ship their
// own html/js/css/json/xml/svg alongside binary assets under the
// course-content storage bucket, served same-origin via vercel.json's
// /course-content/* -> Supabase storage proxy. Supabase's public bucket
// endpoint deliberately overrides Content-Type to text/plain for these
// "renderable as a page" extensions -- an anti-phishing measure with no
// upload-time or query-string opt-out (see
// https://github.com/orgs/supabase/discussions/39110) -- which is why a
// SCORM/xAPI launch page showed as raw markup instead of rendering: the
// iframe got the right bytes back with the wrong header. This middleware
// re-fetches just those extensions and re-serves them with the correct
// Content-Type; everything else under course-content (video, images,
// generic file downloads) still goes straight through vercel.json's routes
// proxy to storage, unchanged.
const CONTENT_TYPES = {
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
  const ext = url.pathname.split('.').pop()?.toLowerCase()
  const contentType = CONTENT_TYPES[ext]
  // Not a type Supabase misreports (video, image, generic file) -- let the
  // existing vercel.json routes proxy handle it exactly as before.
  if (!contentType) return next()

  const objectPath = url.pathname.replace(/^\/course-content\//, '')
  const upstreamUrl = `${process.env.VITE_SUPABASE_URL}/storage/v1/object/public/course-content/${objectPath}`
  const upstream = await fetch(upstreamUrl)
  if (!upstream.ok) return new Response(null, { status: upstream.status })

  const headers = new Headers(upstream.headers)
  headers.set('content-type', contentType)
  // Supabase's override sometimes pairs with a forced attachment
  // disposition -- drop it so the file still renders inline in the iframe
  // rather than triggering a download.
  headers.delete('content-disposition')
  return new Response(upstream.body, { status: upstream.status, headers })
}
