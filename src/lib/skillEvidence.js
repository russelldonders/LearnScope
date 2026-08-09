import { supabase } from './supabaseClient'

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024

export async function uploadEvidence(userId, skillId, assessmentId, file) {
  if (file.size > MAX_EVIDENCE_BYTES) {
    throw new Error('That file is too large (max 10MB).')
  }
  const ext = file.name.split('.').pop()
  const path = `${userId}/${skillId}/${assessmentId}.${ext}`
  const { error } = await supabase.storage
    .from('skill-evidence')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  return path
}

export async function getEvidenceSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from('skill-evidence')
    .createSignedUrl(path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}
