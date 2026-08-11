import { supabase } from './supabaseClient'

const PENDING_INVITE_KEY = 'ls_pending_invite_code'

export function setPendingInviteCode(code) {
  sessionStorage.setItem(PENDING_INVITE_KEY, code)
}

export function getPendingInviteCode() {
  return sessionStorage.getItem(PENDING_INVITE_KEY)
}

export function clearPendingInviteCode() {
  sessionStorage.removeItem(PENDING_INVITE_KEY)
}

export async function createInvite(skillId, email) {
  const { data, error } = await supabase
    .from('connection_invites')
    .insert({ skill_id: skillId, invitee_email: email || null })
    .select('id, share_code')
    .single()
  if (error) throw error
  return { ...data, url: `${window.location.origin}/rate/${data.share_code}` }
}

export async function getInvitePreview(code) {
  const { data, error } = await supabase.rpc('get_invite_preview', { p_code: code })
  if (error) throw error
  return data?.[0] ?? null
}

export async function acceptInviteAndRate(code, level, comments) {
  const { data, error } = await supabase.rpc('accept_invite_and_rate', {
    p_code: code,
    p_level: level,
    p_comments: comments || '',
  })
  if (error) throw error
  return data
}

export async function listSentInvites() {
  const { data, error } = await supabase
    .from('connection_invites')
    .select(
      'id, skill_id, invitee_email, share_code, status, created_at, accepted_at, accepted_by, skills(name, category)'
    )
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((invite) => ({
    ...invite,
    url: `${window.location.origin}/rate/${invite.share_code}`,
  }))
}

// RLS on skill_peer_ratings returns rows where the current user is either
// the rater or the owner of the rated skill — everything needed to render
// both sides is already snapshotted on the row, so this one fetch covers
// both "ratings I gave" and "ratings I received".
export async function listMyPeerRatings() {
  const { data, error } = await supabase
    .from('skill_peer_ratings')
    .select(
      'id, skill_id, skill_name, skill_category, skill_owner_id, rater_id, rater_name, rater_email, level, comments, rated_at'
    )
    .order('rated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getProfileNames(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0) return {}
  const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', ids)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))
}
