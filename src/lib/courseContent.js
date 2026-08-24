import JSZip from 'jszip'
import { supabase } from './supabaseClient'

const BUCKET = 'course-content'

// Rejects anything that could resolve outside the uploaded package's own
// folder once joined onto a path -- a manifest href or zip entry name
// containing a ".." segment or starting with "/" would otherwise let
// scormLaunchUrl's `${storage_path}/${launch_path}` concatenation resolve
// (the browser normalizes ../ against the URL path) into a *different*
// course's storage folder, defeating the "unlisted by uuid" model draft
// content otherwise relies on (see 0071's migration comment).
function isSafeRelativePath(p) {
  if (!p || p.startsWith('/') || p.startsWith('\\')) return false
  return !p.split(/[/\\]/).some((segment) => segment === '..')
}

export async function listCourseContentItems(courseId) {
  const { data, error } = await supabase
    .from('course_content_items')
    .select('*')
    .eq('course_id', courseId)
    .order('position')
  if (error) throw error
  return data ?? []
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
// done" marker.
export async function listContentProgress(userId, contentItemIds) {
  if (contentItemIds.length === 0) return {}
  const { data, error } = await supabase
    .from('course_content_progress')
    .select('content_item_id, status, score')
    .eq('user_id', userId)
    .in('content_item_id', contentItemIds)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((p) => [p.content_item_id, p]))
}

export async function markContentComplete(contentItemId, userId) {
  const { error } = await supabase.from('course_content_progress').upsert(
    { content_item_id: contentItemId, user_id: userId, status: 'completed', updated_at: new Date().toISOString() },
    { onConflict: 'content_item_id,user_id' }
  )
  if (error) throw error
}

async function nextPosition(courseId) {
  const { count, error } = await supabase
    .from('course_content_items')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId)
  if (error) throw error
  return count ?? 0
}

export async function uploadVideoContent(courseId, userId, file, title) {
  return uploadSingleFileContent(courseId, userId, file, title, 'video')
}

export async function uploadFileContent(courseId, userId, file, title) {
  return uploadSingleFileContent(courseId, userId, file, title, 'file')
}

async function uploadSingleFileContent(courseId, userId, file, title, type) {
  const itemId = crypto.randomUUID()
  const path = `${courseId}/${itemId}/${file.name}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type })
  if (uploadError) throw uploadError

  const position = await nextPosition(courseId)
  const { data, error } = await supabase
    .from('course_content_items')
    .insert({
      id: itemId,
      course_id: courseId,
      type,
      title: title?.trim() || file.name,
      position,
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
export async function uploadScormContent(courseId, userId, zipFile, title) {
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
  const folderPrefix = `${courseId}/${itemId}`

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

  const position = await nextPosition(courseId)
  const { data, error } = await supabase
    .from('course_content_items')
    .insert({
      id: itemId,
      course_id: courseId,
      type: 'scorm',
      title: title?.trim() || zipFile.name,
      position,
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

// Recursively removes every object under a content item's storage prefix --
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

export async function deleteContentItem(item) {
  await removeStorageFolder(item.storage_path)
  const { error } = await supabase.from('course_content_items').delete().eq('id', item.id)
  if (error) throw error
}
