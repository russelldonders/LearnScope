import { supabase } from './supabaseClient'

export async function uploadAvatar(userId, fileOrBlob, extHint) {
  const ext = extHint || fileOrBlob.type?.split('/')[1] || 'jpg'
  const path = `${userId}/avatar.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, fileOrBlob, { upsert: true, contentType: fileOrBlob.type })
  if (uploadError) throw uploadError

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  const url = `${data.publicUrl}?t=${Date.now()}`

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_url: url, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (profileError) throw profileError

  return url
}

export function base64ToBlob(base64, contentType) {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: contentType })
}
