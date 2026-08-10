import { supabase } from './supabaseClient'

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024

export async function uploadEvidenceFiles(userId, skillId, assessmentId, files) {
  const paths = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file.size > MAX_EVIDENCE_BYTES) {
      throw new Error(`"${file.name}" is too large (max 10MB).`)
    }
    const ext = file.name.split('.').pop()
    const path = `${userId}/${skillId}/${assessmentId}-${i}.${ext}`
    const { error } = await supabase.storage
      .from('skill-evidence')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (error) throw error
    paths.push(path)
  }
  return paths
}

export async function getEvidenceSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from('skill-evidence')
    .createSignedUrl(path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}
