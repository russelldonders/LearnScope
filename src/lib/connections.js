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

export async function createInvite(skillId, email, inviterId) {
  const { data, error } = await supabase
    .from('connection_invites')
    .insert({ skill_id: skillId, invitee_email: email || null, inviter_id: inviterId })
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
      'id, skill_id, skill_name, skill_category, skill_owner_id, skill_owner_email, rater_id, rater_name, rater_email, level, comments, rated_at'
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

// Distinct people the user has a rating history with, one row each (most
// recent interaction wins since listMyPeerRatings is already sorted desc),
// with an email resolved for either direction — needed so the invite flow
// can offer "pick an existing connection" instead of retyping an address.
export async function listConnections(currentUserId) {
  const ratings = await listMyPeerRatings()
  const map = new Map()
  for (const r of ratings) {
    const gaveRating = r.rater_id === currentUserId
    const otherId = gaveRating ? r.skill_owner_id : r.rater_id
    if (map.has(otherId)) continue
    map.set(otherId, {
      email: gaveRating ? r.skill_owner_email : r.rater_email,
      fallbackName: gaveRating ? null : r.rater_name,
    })
  }
  const names = await getProfileNames([...map.keys()])
  return [...map.entries()].map(([id, v]) => ({
    id,
    email: v.email || null,
    name: names[id] || v.fallbackName || v.email || 'Someone',
  }))
}
