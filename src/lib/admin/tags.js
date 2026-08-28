import { supabase } from '../supabaseClient'

// Admin listing -- includes blacklisted tags, unlike src/lib/skillTags.js's
// listTags (learner-facing, excludes them).
export async function listAllTags() {
  const { data, error } = await supabase.from('tags').select('id, name, is_blacklisted').order('name').limit(1000)
  if (error) throw error
  return data ?? []
}

export async function setTagBlacklisted(id, isBlacklisted) {
  const { error } = await supabase.from('tags').update({ is_blacklisted: isBlacklisted }).eq('id', id)
  if (error) throw error
}
