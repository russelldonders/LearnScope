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
// needed to unlink) and `position`.
export async function listCourseResources(courseId) {
  const { data, error } = await supabase
    .from('course_content_links')
    .select('id, position, resource:content_resources(*)')
    .eq('course_id', courseId)
    .order('position')
  if (error) throw error
  return (data ?? []).map((link) => ({ ...link.resource, linkId: link.id, position: link.position }))
}

async function nextLinkPosition(courseId) {
  const { count, error } = await supabase
    .from('course_content_links')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId)
  if (error) throw error
  return count ?? 0
}

export async function linkResourceToCourse(courseId, resourceId) {
  const position = await nextLinkPosition(courseId)
  const { error } = await supabase
    .from('course_content_links')
    .insert({ course_id: courseId, resource_id: resourceId, position })
  if (error) throw error
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
function publicUrlFor(path) {
  return `/course-content/${path}`
}

export function contentFileUrl(item) {
  return publicUrlFor(item.storage_path)
}

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

// SCORM 1.2/2004 packages ship as a zip of many interlinked files
// (html/js/css/images) referencing each other by relative path -- there's
// no single "the file" to upload, so the zip is extracted client-side
// (JSZip) and every entry is uploaded individually under one folder, then
// the manifest tells us which extracted file is the actual launch page.
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
  await removeStorageFolder(resource.storage_path)
  const { error } = await supabase.from('content_resources').delete().eq('id', resource.id)
  if (error) throw error
}
