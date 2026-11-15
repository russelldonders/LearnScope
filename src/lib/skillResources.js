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
