import JSZip from 'jszip'
import { supabase } from './supabaseClient'

const BUCKET = 'course-content'

// Rejects anything that could resolve outside the uploaded package's own
// folder once joined onto a path -- a manifest href or zip entry name
// containing a ".." segment or starting with "/" would otherwise let
// scormLaunchUrl's `${storage_path}/${launch_path}` concatenation resolve
// (the browser normalizes ../ against the URL path) into a *different*
// resource's storage folder, defeating the "unlisted by uuid" model draft
// content otherwise relies on (see 0071's migration comment).
function isSafeRelativePath(p) {
  if (!p || p.startsWith('/') || p.startsWith('\\')) return false
  return !p.split(/[/\\]/).some((segment) => segment === '..')
}

// An organisation's whole content library (video/file/SCORM), independent
// of which courses it's attached to -- see 0073's migration comment for why
// this moved off course_content_items (one row per course) to
// content_resources (one row per org, reusable via course_content_links).
export async function listOrganisationResources(organisationId) {
  const { data, error } = await supabase
    .from('content_resources')
    .select('*')
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Resources attached to one specific course, in that course's own order --
// the same resource can appear (independently ordered) in more than one
// course's list, since attachment is many-to-many. Each returned object is
// the resource itself plus `linkId` (the course_content_links row id,
// needed to unlink), `position` (order within its section), and
// `sectionId` (0078) -- callers that don't care about section grouping
// (e.g. CourseLearn's flat prev/next sequencing) can just ignore it.
export async function listCourseResources(courseId) {
  const { data, error } = await supabase
    .from('course_content_links')
    .select('id, position, section_id, resource:content_resources(*)')
    .eq('course_id', courseId)
    .order('position')
  if (error) throw error
  return (data ?? []).map((link) => ({
    ...link.resource,
    linkId: link.id,
    position: link.position,
    sectionId: link.section_id,
  }))
}

// -- course_sections (0078): named, ordered groups of a course's content --

export async function listCourseSections(courseId) {
  const { data, error } = await supabase
    .from('course_sections')
    .select('id, title, position')
    .eq('course_id', courseId)
    .order('position')
  if (error) throw error
  return data ?? []
}

async function nextSectionPosition(courseId) {
  const { count, error } = await supabase
    .from('course_sections')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId)
  if (error) throw error
  return count ?? 0
}

export async function createCourseSection(courseId, title) {
  const position = await nextSectionPosition(courseId)
  const { data, error } = await supabase
    .from('course_sections')
    .insert({ course_id: courseId, title: title.trim(), position })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function renameCourseSection(sectionId, title) {
  const { error } = await supabase.from('course_sections').update({ title: title.trim() }).eq('id', sectionId)
  if (error) throw error
}

// Deletes the section only -- any content still linked into it stays
// attached to the course (course_content_links.section_id is "on delete set
// null", 0078), it just becomes ungrouped rather than being detached.
export async function deleteCourseSection(sectionId) {
  const { error } = await supabase.from('course_sections').delete().eq('id', sectionId)
  if (error) throw error
}

// Swaps this section with its immediate neighbour -- the simplest reorder
// primitive that needs no drag-and-drop dependency; `sections` is the
// caller's already-loaded, position-ordered list.
export async function moveCourseSection(sections, sectionId, direction) {
  const index = sections.findIndex((s) => s.id === sectionId)
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || swapIndex < 0 || swapIndex >= sections.length) return
  const a = sections[index]
  const b = sections[swapIndex]
  const { error: errorA } = await supabase.from('course_sections').update({ position: b.position }).eq('id', a.id)
  if (errorA) throw errorA
  const { error: errorB } = await supabase.from('course_sections').update({ position: a.position }).eq('id', b.id)
  if (errorB) throw errorB
}

async function nextLinkPosition(sectionId) {
  const { count, error } = await supabase
    .from('course_content_links')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', sectionId)
  if (error) throw error
  return count ?? 0
}

export async function linkResourceToCourse(courseId, resourceId, sectionId) {
  const position = await nextLinkPosition(sectionId)
  const { error } = await supabase
    .from('course_content_links')
    .insert({ course_id: courseId, resource_id: resourceId, section_id: sectionId, position })
  if (error) throw error
}

// Swaps this item with its immediate neighbour within the same section --
// `sectionItems` is the caller's already-loaded, position-ordered list for
// just that one section (moving an item between sections isn't supported
// here; detach and re-add to the other section instead).
export async function moveContentLink(sectionItems, linkId, direction) {
  const index = sectionItems.findIndex((r) => r.linkId === linkId)
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (index === -1 || swapIndex < 0 || swapIndex >= sectionItems.length) return
  const a = sectionItems[index]
  const b = sectionItems[swapIndex]
  const { error: errorA } = await supabase
    .from('course_content_links')
    .update({ position: b.position })
    .eq('id', a.linkId)
  if (errorA) throw errorA
  const { error: errorB } = await supabase
    .from('course_content_links')
    .update({ position: a.position })
    .eq('id', b.linkId)
  if (errorB) throw errorB
}

// Detaches a resource from this course -- the resource itself (and any
// other course it's attached to) is untouched, matching the "unlinking
// doesn't delete the underlying record" rule everywhere else in this app.
export async function unlinkResourceFromCourse(linkId) {
  const { error } = await supabase.from('course_content_links').delete().eq('id', linkId)
  if (error) throw error
}

// Served through the app's own domain (vercel.json's /course-content/*
// proxy to the storage bucket), not Supabase's own public URL -- SCORM
// content run in an iframe needs to be same-origin with the parent page for
// window.parent.API to be reachable at all (cross-origin, the browser
// blocks that property access outright, no matter what CORS headers say).
// Video/file use the same scheme too, for one consistent URL shape.
//
// The proxy is a plain vercel.json `routes` external-URL rewrite rather
// than a Vercel function/middleware -- both were tried and both failed for
// the same reason: this project's zero-config Vite routing serves the SPA
// shell instead of a function for "navigate"-type requests (exactly what an
// iframe's src load is), even when the path matches a real function route.
// `routes` isn't subject to that, since it's a raw proxy rule rather than a
// function invocation. Its `transforms` force the right Content-Type on the
// html/js/css/json/xml/svg extensions Supabase's public bucket endpoint
// otherwise serves back as text/plain (an anti-phishing measure with no
// upload-time or query-string opt-out --
// https://github.com/orgs/supabase/discussions/39110), and also strip
// Supabase's own `Content-Security-Policy: default-src 'none'; sandbox`
// response header on those same extensions -- a second, independent layer
// of the same anti-abuse hardening, which otherwise blocks all script
// execution for the document regardless of the embedding iframe's own
// sandbox tokens (CSP `sandbox` is additive/more-restrictive, never less).
// Deliberately widens the known, tracked course-content-bucket XSS exposure
// (a malicious upload navigated to directly, top-level, outside the
// sandboxed player, can now execute script where before it silently
// couldn't) -- an explicit, accepted tradeoff to make SCORM/xAPI content
// work at all before the real fix (an isolated content origin) exists; see
// that memory/issue before changing this again.
function publicUrlFor(path) {
  return `/course-content/${path}`
}

export function contentFileUrl(item) {
  return publicUrlFor(item.storage_path)
}

// Shared by SCORM and xAPI packages alike -- both are "storage_path folder
// + launch_path entry file" content, just launched differently (SCORM via
// window.API, xAPI via URL query params -- see ScormPlayer.jsx/
// XapiPlayer.jsx).
export function scormLaunchUrl(item) {
  if (!item.launch_path) return null
  return publicUrlFor(`${item.storage_path}/${item.launch_path}`)
}

// SCORM items track their own progress via ScormPlayer's window.API
// (LMSSetValue/LMSCommit/LMSFinish); this is for video/file items, which
// have no runtime of their own -- just a plain "the learner said they're
// done" marker. Progress is keyed by resource id, not by course -- a
// resource watched/completed once stays completed wherever else it's
// attached, rather than tracking a separate completion per course.
export async function listContentProgress(userId, resourceIds) {
  if (resourceIds.length === 0) return {}
  const { data, error } = await supabase
    .from('course_content_progress')
    .select('content_item_id, status, score')
    .eq('user_id', userId)
    .in('content_item_id', resourceIds)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((p) => [p.content_item_id, p]))
}

// Aggregates course_content_progress across one or more catalogue courses at
// once -- a tile grid of many enrolled courses needs every course's percent
// in one page load, not one query per course. Returns
// { [catalogueCourseId]: { completed, total } }; a catalogue course with no
// linked resources yet (or not passed in) is simply absent from the result,
// since there's nothing meaningful to show a percentage for. Reuses
// listContentProgress's own "what counts as complete" rule (status set and
// not 'not_attempted') rather than re-deriving it here.
export async function listCourseProgressByCatalogueId(catalogueCourseIds, userId) {
  const ids = [...new Set(catalogueCourseIds.filter(Boolean))]
  if (ids.length === 0) return {}

  const { data: links, error } = await supabase
    .from('course_content_links')
    .select('course_id, resource_id')
    .in('course_id', ids)
  if (error) throw error

  const resourceIds = [...new Set((links ?? []).map((l) => l.resource_id))]
  const progressByResourceId = await listContentProgress(userId, resourceIds)

  const result = {}
  for (const link of links ?? []) {
    const entry = result[link.course_id] ?? (result[link.course_id] = { completed: 0, total: 0 })
    entry.total += 1
    const status = progressByResourceId[link.resource_id]?.status
    if (status && status !== 'not_attempted') entry.completed += 1
  }
  return result
}

export async function markContentComplete(resourceId, userId) {
  const { error } = await supabase.from('course_content_progress').upsert(
    { content_item_id: resourceId, user_id: userId, status: 'completed', updated_at: new Date().toISOString() },
    { onConflict: 'content_item_id,user_id' }
  )
  if (error) throw error
}

export async function uploadVideoResource(organisationId, userId, file, title) {
  return uploadSingleFileResource(organisationId, userId, file, title, 'video')
}

// Rebuilds a bare embed URL from a YouTube/Vimeo watch link ourselves,
// rather than storing (and later using as an iframe src) whatever the
// provider actually pasted -- an allowlisted host plus an id we extracted
// keeps arbitrary query-string content out of the stored URL, so there's no
// path from a crafted link to embedding a different, attacker-chosen page.
function externalVideoEmbedUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Enter a valid video URL.')
  }
  const host = parsed.hostname.replace(/^www\./, '')

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = parsed.pathname === '/watch' ? parsed.searchParams.get('v') : parsed.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1]
    if (id) return `https://www.youtube.com/embed/${id}`
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1)
    if (id) return `https://www.youtube.com/embed/${id}`
  }
  if (host === 'vimeo.com') {
    const id = parsed.pathname.match(/^\/(\d+)/)?.[1]
    if (id) return `https://player.vimeo.com/video/${id}`
  }
  if (host === 'player.vimeo.com') {
    const id = parsed.pathname.match(/^\/video\/(\d+)/)?.[1]
    if (id) return `https://player.vimeo.com/video/${id}`
  }

  throw new Error('Only YouTube and Vimeo links are supported.')
}

export async function addExternalVideoResource(organisationId, userId, url, title) {
  const embedUrl = externalVideoEmbedUrl(url.trim())
  const { data, error } = await supabase
    .from('content_resources')
    .insert({
      organisation_id: organisationId,
      type: 'external_video',
      title: title?.trim() || url.trim(),
      external_url: embedUrl,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Non-destructive video edit (trim/filter/speed/overlays, 0087) -- see
// videoEdit.js for the stored shape. Applied at playback time only; never
// touches the uploaded file or storage.
export async function updateVideoEdit(resourceId, videoEdit) {
  const { data, error } = await supabase
    .from('content_resources')
    .update({ video_edit: videoEdit })
    .eq('id', resourceId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function uploadFileResource(organisationId, userId, file, title) {
  return uploadSingleFileResource(organisationId, userId, file, title, 'file')
}

async function uploadSingleFileResource(organisationId, userId, file, title, type) {
  const itemId = crypto.randomUUID()
  const path = `${organisationId}/${itemId}/${file.name}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('content_resources')
    .insert({
      id: itemId,
      organisation_id: organisationId,
      type,
      title: title?.trim() || file.name,
      storage_path: path,
      file_name: file.name,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Shared by SCORM and xAPI uploads -- both ship as a zip of many
// interlinked files (html/js/css/images) referencing each other by
// relative path, so there's no single "the file" to upload; every entry is
// extracted client-side (JSZip) and uploaded individually under one folder.
async function uploadZipEntries(zip, folderPrefix) {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  for (const entry of entries) {
    if (!isSafeRelativePath(entry.name)) {
      throw new Error(`This package contains an unsafe file path ("${entry.name}") and can't be uploaded.`)
    }
    const blob = await entry.async('blob')
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(`${folderPrefix}/${entry.name}`, blob, { contentType: guessContentType(entry.name) })
    if (uploadError) throw uploadError
  }
}

// SCORM 1.2/2004 packages -- the manifest tells us which extracted file is
// the actual launch page.
export async function uploadScormResource(organisationId, userId, zipFile, title) {
  const zip = await JSZip.loadAsync(zipFile)

  const manifestEntry = zip.file(/^imsmanifest\.xml$/i)[0]
  if (!manifestEntry) {
    throw new Error('This doesn\'t look like a SCORM package -- no imsmanifest.xml found in the zip.')
  }
  const manifestXml = await manifestEntry.async('string')
  const launchPath = parseScormLaunchPath(manifestXml)
  if (!launchPath) {
    throw new Error('Could not determine a launch page from imsmanifest.xml.')
  }

  const itemId = crypto.randomUUID()
  const folderPrefix = `${organisationId}/${itemId}`
  await uploadZipEntries(zip, folderPrefix)

  const { data, error } = await supabase
    .from('content_resources')
    .insert({
      id: itemId,
      organisation_id: organisationId,
      type: 'scorm',
      title: title?.trim() || zipFile.name,
      storage_path: folderPrefix,
      file_name: zipFile.name,
      launch_path: launchPath,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// xAPI (Tin Can) packages -- same zip-of-files shape as SCORM, but the
// manifest is tincan.xml, not imsmanifest.xml, and its schema is simpler
// (one or more <activity><launch> entries; the first activity's launch is
// used, matching how a content_resources row represents one launchable
// thing). Played back via XapiPlayer.jsx, which speaks the launch URL +
// LRS convention rather than SCORM's window.API.
export async function uploadXapiResource(organisationId, userId, zipFile, title) {
  const zip = await JSZip.loadAsync(zipFile)

  const manifestEntry = zip.file(/^tincan\.xml$/i)[0]
  if (!manifestEntry) {
    throw new Error('This doesn\'t look like an xAPI package -- no tincan.xml found in the zip.')
  }
  const manifestXml = await manifestEntry.async('string')
  const launchPath = parseTincanLaunchPath(manifestXml)
  if (!launchPath) {
    throw new Error('Could not determine a launch page from tincan.xml.')
  }

  const itemId = crypto.randomUUID()
  const folderPrefix = `${organisationId}/${itemId}`
  await uploadZipEntries(zip, folderPrefix)

  const { data, error } = await supabase
    .from('content_resources')
    .insert({
      id: itemId,
      organisation_id: organisationId,
      type: 'xapi',
      title: title?.trim() || zipFile.name,
      storage_path: folderPrefix,
      file_name: zipFile.name,
      launch_path: launchPath,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Takes the first <activity>'s <launch> element -- multi-activity packages
// exist, but a content_resources row always represents one launchable
// thing, same as SCORM's single launch_path.
function parseTincanLaunchPath(manifestXml) {
  const doc = new DOMParser().parseFromString(manifestXml, 'application/xml')
  if (doc.querySelector('parsererror')) return null

  const launch = doc.getElementsByTagName('launch')[0]
  const href = launch?.textContent?.trim()
  return href && isSafeRelativePath(href) ? href : null
}

// A stable activity identifier derived from our own resource id, rather
// than trusting whatever `id` an uploaded package's tincan.xml happens to
// declare -- an uploaded manifest is untrusted content, and activity
// identity is what statements key off of, so it shouldn't be sourced from
// data the uploader controls.
export function xapiActivityId(resource) {
  return `https://learnscope.app/xapi/activities/${resource.id}`
}

// One row per "launch" -- see 0079_xapi_resources.sql for why this exists
// (the package authenticates its own statement submissions with this
// session's token, not a Supabase session). courseId is optional: previewing
// a resource from the org's library, not yet attached to an enrolled
// course, has no course context.
export async function createXapiLaunchSession(resourceId, userId, courseId = null) {
  const { data, error } = await supabase
    .from('xapi_launch_sessions')
    .insert({ resource_id: resourceId, user_id: userId, course_id: courseId })
    .select('id, token')
    .single()
  if (error) throw error
  return data
}

// Walks <organizations>/<organization identifier="{default}">, depth-first,
// for the first <item> carrying an identifierref, then resolves that to its
// <resource href="...">. Falls back to the first webcontent resource's href
// if the organizations structure is missing/malformed, since some
// real-world packages are non-conformant here.
function parseScormLaunchPath(manifestXml) {
  const doc = new DOMParser().parseFromString(manifestXml, 'application/xml')
  if (doc.querySelector('parsererror')) return null

  const resources = doc.getElementsByTagName('resource')
  const resourceHrefById = new Map()
  for (const resource of resources) {
    const id = resource.getAttribute('identifier')
    const href = resource.getAttribute('href')
    if (id && href) resourceHrefById.set(id, href)
  }

  const organizations = doc.getElementsByTagName('organizations')[0]
  if (organizations) {
    const defaultOrgId = organizations.getAttribute('default')
    const orgs = organizations.getElementsByTagName('organization')
    const defaultOrg = [...orgs].find((o) => o.getAttribute('identifier') === defaultOrgId) ?? orgs[0]
    if (defaultOrg) {
      const items = defaultOrg.getElementsByTagName('item')
      for (const item of items) {
        const ref = item.getAttribute('identifierref')
        if (ref && resourceHrefById.has(ref)) {
          const href = resourceHrefById.get(ref)
          return isSafeRelativePath(href) ? href : null
        }
      }
    }
  }

  const fallback = resourceHrefById.values().next().value ?? null
  return fallback && isSafeRelativePath(fallback) ? fallback : null
}

function guessContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map = {
    html: 'text/html', htm: 'text/html', js: 'application/javascript', css: 'text/css',
    json: 'application/json', xml: 'application/xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', mp3: 'audio/mpeg', mp4: 'video/mp4',
  }
  return map[ext] || 'application/octet-stream'
}

// Recursively removes every object under a resource's storage prefix --
// storage.list() only returns one folder level at a time, so this walks the
// tree for SCORM items (many nested files); video/file items are a single
// path so this resolves in one call.
const LIST_PAGE_SIZE = 1000

async function listAllEntries(prefix) {
  const entries = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: LIST_PAGE_SIZE, offset })
    if (error) throw error
    entries.push(...(data ?? []))
    if (!data || data.length < LIST_PAGE_SIZE) break
    offset += LIST_PAGE_SIZE
  }
  return entries
}

async function removeStorageFolder(prefix) {
  const entries = await listAllEntries(prefix)
  if (entries.length === 0) {
    await supabase.storage.from(BUCKET).remove([prefix])
    return
  }
  const filePaths = []
  for (const entry of entries) {
    const entryPath = `${prefix}/${entry.name}`
    if (entry.id === null) {
      await removeStorageFolder(entryPath)
    } else {
      filePaths.push(entryPath)
    }
  }
  if (filePaths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(filePaths)
    if (removeError) throw removeError
  }
}

// Deletes the resource itself (and its storage files) -- not just an
// attachment. course_content_links rows referencing it cascade-delete at
// the DB level (0073), so it disappears from every course it was attached
// to, not just the one you were looking at when you deleted it.
export async function deleteResource(resource) {
  if (resource.type !== 'external_video') await removeStorageFolder(resource.storage_path)
  const { error } = await supabase.from('content_resources').delete().eq('id', resource.id)
  if (error) throw error
}
