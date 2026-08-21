import { supabase } from './supabaseClient'

// People (across the whole platform, not just existing connections) who
// also track this same library skill and have opted into skill-search
// visibility -- see list_skill_matches in 0058_skill_discovery_and_connections.sql
// for exactly which visibility rules gate each row.
export async function listSkillMatches(libraryskillId) {
  const { data, error } = await supabase.rpc('list_skill_matches', { p_library_skill_id: libraryskillId })
  if (error) throw error
  return data ?? []
}

export async function sendConnectionRequest({ recipientId, skillId, message }) {
  const { error } = await supabase.from('connection_requests').insert({
    recipient_id: recipientId,
    skill_id: skillId || null,
    message: message?.trim() || null,
  })
  if (error) throw error
}

export function isDuplicatePendingRequestError(error) {
  return error?.code === '23505' && error?.message?.includes('connection_requests_pending_pair_idx')
}

export async function listIncomingConnectionRequests() {
  const { data, error } = await supabase
    .from('connection_requests')
    .select('id, requester_id, skill_id, message, status, created_at, skills(name)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function listSentConnectionRequests() {
  const { data, error } = await supabase
    .from('connection_requests')
    .select('id, recipient_id, skill_id, message, status, created_at, skills(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function respondToConnectionRequest(requestId, accept) {
  const { error } = await supabase
    .from('connection_requests')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', requestId)
  if (error) throw error
}

export async function getSearchPrivacySettings(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('skill_search_visibility, auto_include_new_skills_in_search, profile_visible_to_skill_matches')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function updateSearchPrivacySettings(userId, patch) {
  const { error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}

export async function listSearchableSkillIds(userId) {
  const { data, error } = await supabase.from('profile_searchable_skills').select('skill_id').eq('profile_id', userId)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.skill_id))
}

export async function setSkillSearchable(userId, skillId, enabled) {
  if (enabled) {
    const { error } = await supabase
      .from('profile_searchable_skills')
      .insert({ profile_id: userId, skill_id: skillId })
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await supabase
      .from('profile_searchable_skills')
      .delete()
      .eq('profile_id', userId)
      .eq('skill_id', skillId)
    if (error) throw error
  }
}
