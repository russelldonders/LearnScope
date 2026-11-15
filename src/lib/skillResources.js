import { supabase } from './supabaseClient'

// A learner's own resources on a skill -- documents, videos and links they
// keep for learning it -- and the ones others have shared with them. See
// 20261115160000_0288_skill_resources.sql for who can see what; the database
// enforces it, this only offers the choices.

const BUCKET = 'skill-resources'
export const MAX_RESOURCE_FILE_BYTES = 50 * 1024 * 1024
// The kinds of file the storage bucket accepts (documents, images, audio,
// video), for the file picker.
export const RESOURCE_FILE_ACCEPT = [
  '.pdf', '.txt', '.md', '.csv', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf', '.epub', '.zip',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
  'audio/*', 'video/mp4', 'video/webm', 'video/quicktime',
].join(',')

export const RESOURCE_KINDS = ['link', 'video', 'file']
export const RESOURCE_AUDIENCES = ['private', 'selected', 'connections', 'skill_public']

// Who a resource can go to. An uploaded file is never shared with everyone
// tracking the skill, and a skill not from the library has no one else
// tracking it.
export function audiencesFor(kind, { hasLibrarySkill }) {
  return RESOURCE_AUDIENCES.filter((audience) => {
    if (audience !== 'skill_public') return true
    return kind !== 'file' && hasLibrarySkill
  })
}

export function isHttpUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function listMyResources(skillId) {
  const { data, error } = await supabase
    .from('skill_resources')
    .select('*, skill_resource_recipients(recipient_id)')
    .eq('skill_id', skillId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(({ skill_resource_recipients: recipients, ...resource }) => ({
    ...resource,
    recipientIds: (recipients ?? []).map((r) => r.recipient_id),
  }))
}

export async function listSharedResources(skillId) {
  const { data, error } = await supabase.rpc('list_shared_skill_resources', { p_skill_id: skillId })
  if (error) throw error
  return data ?? []
}

async function setRecipients(resourceId, audience, recipientIds, previousIds = []) {
  const wanted = audience === 'selected' ? [...new Set(recipientIds)] : []
  const removed = previousIds.filter((id) => !wanted.includes(id))
  const added = wanted.filter((id) => !previousIds.includes(id))
  if (removed.length) {
    const { error } = await supabase
      .from('skill_resource_recipients')
      .delete()
      .eq('resource_id', resourceId)
      .in('recipient_id', removed)
    if (error) throw error
  }
  if (added.length) {
    const { error } = await supabase
      .from('skill_resource_recipients')
      .insert(added.map((recipient_id) => ({ resource_id: resourceId, recipient_id })))
    if (error) throw error
  }
}

function fileExtension(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(name ?? '')
  return match ? `.${match[1].toLowerCase()}` : ''
}

// kind 'link' or 'video' takes url; 'file' takes file (a File).
export async function addResource({ userId, skillId, kind, title, url, file, note, audience, recipientIds = [], knowledgeLevel = null, practicalLevel = null }) {
  const base = {
    user_id: userId,
    skill_id: skillId,
    kind,
    title: title.trim(),
    note: note?.trim() || null,
    audience,
    knowledge_level: knowledgeLevel || null,
    practical_level: practicalLevel || null,
  }
  let row
  if (kind === 'file') {
    if (!file) throw new Error('Choose a file to upload.')
    if (file.size > MAX_RESOURCE_FILE_BYTES) throw new Error(`"${file.name}" is too large (max 50MB).`)
    const path = `${userId}/${skillId}/${crypto.randomUUID()}${fileExtension(file.name)}`
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined })
    if (uploadError) throw uploadError
    row = { ...base, file_path: path, file_name: file.name, file_size: file.size, mime_type: file.type || null }
    const { data, error } = await supabase.from('skill_resources').insert(row).select('id').single()
    if (error) {
      // Don't leave an orphaned file behind.
      await supabase.storage.from(BUCKET).remove([path])
      throw error
    }
    await setRecipients(data.id, audience, recipientIds)
    return data.id
  }
  row = { ...base, url: url.trim() }
  const { data, error } = await supabase.from('skill_resources').insert(row).select('id').single()
  if (error) throw error
  await setRecipients(data.id, audience, recipientIds)
  return data.id
}

// Title, note, levels and who it's shared with; what the resource is stays
// as added.
export async function updateResource(resource, { title, note, audience, recipientIds = [], knowledgeLevel = null, practicalLevel = null }) {
  const { error } = await supabase
    .from('skill_resources')
    .update({
      title: title.trim(),
      note: note?.trim() || null,
      audience,
      knowledge_level: knowledgeLevel || null,
      practical_level: practicalLevel || null,
    })
    .eq('id', resource.id)
  if (error) throw error
  await setRecipients(resource.id, audience, recipientIds, resource.recipientIds ?? [])
}

export async function deleteResource(resource) {
  const { error } = await supabase.from('skill_resources').delete().eq('id', resource.id)
  if (error) throw error
  if (resource.file_path) {
    // The record is gone either way; a file left behind is only unreachable.
    await supabase.storage.from(BUCKET).remove([resource.file_path])
  }
}

export async function getResourceFileUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 10 * 60)
  if (error) throw error
  return data.signedUrl
}

// How well a resource suits the learner's current levels, on the axes where
// both the resource and the learner have one. Per axis: 'current' (the
// learner's level), 'next' (one above: the next step), or null (further off).
// distance is 0 for a resource at the current or next level, growing by one
// for each level further away; null when nothing can be compared.
export function resourceLevelFit(resource, { knowledge = null, practical = null } = {}) {
  const axes = []
  if (resource.knowledge_level && knowledge) axes.push({ axis: 'knowledge', gap: resource.knowledge_level - knowledge })
  if (resource.practical_level && practical) axes.push({ axis: 'practical', gap: resource.practical_level - practical })
  if (axes.length === 0) return null
  const fitOf = (gap) => (gap === 0 ? 'current' : gap === 1 ? 'next' : null)
  const distanceOf = (gap) => (gap < 0 ? -gap : Math.max(0, gap - 1))
  return {
    distance: axes.reduce((sum, a) => sum + distanceOf(a.gap), 0) / axes.length,
    // The next step reads first: it's where the learner is heading.
    fit: axes.some((a) => fitOf(a.gap) === 'next') ? 'next' : axes.every((a) => fitOf(a.gap) === 'current') ? 'current' : null,
  }
}

// Resources at the chosen levels. An empty filter keeps everything; a level
// chosen on an axis keeps only resources aligned to exactly that level there.
export function filterResourcesByLevel(resources, { knowledge = '', practical = '' } = {}) {
  return resources.filter((resource) =>
    (!knowledge || resource.knowledge_level === Number(knowledge))
    && (!practical || resource.practical_level === Number(practical)))
}

// Nearest the learner's levels first, then newest. Resources that can't be
// compared go last, newest first.
export function sortResourcesByFit(resources, levels) {
  const keyed = resources.map((resource) => ({ resource, fit: resourceLevelFit(resource, levels) }))
  return keyed
    .sort((a, b) => {
      if (a.fit && !b.fit) return -1
      if (!a.fit && b.fit) return 1
      if (a.fit && b.fit && a.fit.distance !== b.fit.distance) return a.fit.distance - b.fit.distance
      return String(b.resource.created_at ?? '').localeCompare(String(a.resource.created_at ?? ''))
    })
    .map(({ resource }) => resource)
}

// Up to `limit` resources at the learner's current level or the next one up,
// next steps first.
export function suggestResourcesForLevel(resources, levels, limit = 3) {
  const rank = { next: 0, current: 1 }
  return resources
    .map((resource) => ({ resource, fit: resourceLevelFit(resource, levels) }))
    .filter(({ fit }) => fit && fit.distance === 0 && fit.fit)
    .sort((a, b) => rank[a.fit.fit] - rank[b.fit.fit]
      || String(b.resource.created_at ?? '').localeCompare(String(a.resource.created_at ?? '')))
    .slice(0, limit)
}

// Hiding and reporting a resource someone else shared (0292). Reporting
// hides it too.
export const REPORT_REASONS = ['spam', 'inappropriate', 'misleading', 'other']

export async function hideSharedResource(userId, resourceId) {
  const { error } = await supabase.from('skill_resource_hides').upsert(
    { user_id: userId, resource_id: resourceId },
    { onConflict: 'user_id,resource_id', ignoreDuplicates: true },
  )
  if (error) throw error
}

export async function unhideSharedResource(userId, resourceId) {
  const { error } = await supabase
    .from('skill_resource_hides')
    .delete()
    .eq('user_id', userId)
    .eq('resource_id', resourceId)
  if (error) throw error
}

export async function reportSharedResource(resourceId, reason, details) {
  const { error } = await supabase.rpc('report_skill_resource', {
    p_resource_id: resourceId,
    p_reason: reason,
    p_details: details?.trim() || null,
  })
  if (error) throw error
}

// Platform admins.
export async function adminListResourceReports() {
  const { data, error } = await supabase.rpc('admin_list_skill_resource_reports')
  if (error) throw error
  return data ?? []
}

export async function adminResolveResourceReports(resourceId, action) {
  const { error } = await supabase.rpc('admin_resolve_skill_resource_reports', {
    p_resource_id: resourceId,
    p_action: action,
  })
  if (error) throw error
}
