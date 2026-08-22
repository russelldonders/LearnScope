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
  // The insert RLS policy requires auth.uid() = requester_id -- without
  // setting it explicitly the column stays null and the policy check fails
  // ("new row violates row-level security policy"), since there's no
  // column default or trigger that fills it in server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase.from('connection_requests').insert({
    requester_id: user.id,
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

// Goes through the respond_to_connection_request RPC rather than a direct
// table update -- RLS can restrict which rows are updatable but not which
// columns change, so accept/decline is handled server-side (see
// 0060_fix_connection_request_and_skill_search_gaps.sql) to stop a
// recipient from rewriting requester_id and forging a connection to
// someone who never sent them anything.
export async function respondToConnectionRequest(requestId, accept) {
  const { error } = await supabase.rpc('respond_to_connection_request', {
    p_request_id: requestId,
    p_accept: accept,
  })
  if (error) throw error
}

export async function getSearchPrivacySettings(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'skill_search_visibility, auto_include_new_skills_in_search, profile_visible_to_skill_matches, activity_feed_visible'
    )
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
