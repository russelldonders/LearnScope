import { supabase } from './supabaseClient'

const PENDING_INVITE_KEY = 'ls_pending_invite_code'

// localStorage, not sessionStorage -- the signup path routes through an
// emailed confirmation link, which almost always opens in a new tab (or a
// mail app's in-app browser). sessionStorage doesn't survive that, so the
// invitee would land back on /welcome with no memory of the invite that
// brought them here. Welcome.jsx also gets the code via a ?invite= query
// param on the confirmation redirect itself (see signUp in AuthContext),
// which is the more robust path since it survives even a different
// device/browser than the one signup was started on -- this storage is the
// same-browser fallback for the plain login/Google-OAuth paths.
export function setPendingInviteCode(code) {
  localStorage.setItem(PENDING_INVITE_KEY, code)
}

export function getPendingInviteCode() {
  return localStorage.getItem(PENDING_INVITE_KEY)
}

export function clearPendingInviteCode() {
  localStorage.removeItem(PENDING_INVITE_KEY)
}

export function isDuplicatePendingInviteError(error) {
  return error?.code === '23505' && error?.message?.includes('connection_invites_unique_pending_idx')
}

export function duplicatePendingInviteMessage(email) {
  return `You already have a pending invite out to ${email} for this skill.`
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

// Shared by the first-send flow (InviteRaterModal) and the resend action on
// the Connections page so both go through the same Resend-backed endpoint.
export async function sendInviteEmail({ toEmail, inviterName, skillName, shareUrl }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/send-invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ toEmail, inviterName, skillName, shareUrl }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to send invite email.')
  }
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

// Invites addressed to the current user's own email that they haven't
// clicked through yet -- see list_incoming_rate_invites in
// 0061_incoming_rate_invites.sql for why this needs a SECURITY DEFINER RPC
// rather than a plain table select.
export async function listIncomingRateInvites() {
  const { data, error } = await supabase.rpc('list_incoming_rate_invites')
  if (error) throw error
  return (data ?? []).map((invite) => ({ ...invite, url: `${window.location.origin}/rate/${invite.share_code}` }))
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

export async function revokeInvite(inviteId) {
  const { error } = await supabase
    .from('connection_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
  if (error) throw error
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

// Like getProfileNames but also carries the avatar, for surfaces that show a
// person's photo next to their name (e.g. the connections list).
export async function getProfiles(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0) return {}
  const { data, error } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids)
  if (error) throw error
  return Object.fromEntries((data ?? []).map((p) => [p.id, { name: p.full_name, avatarUrl: p.avatar_url }]))
}

// Everyone the user is connected to, from the connections table (see
// 0058_skill_discovery_and_connections.sql) — not just people they have a
// rating history with; a direct connection request that's been accepted
// counts too, even with no peer rating between them yet. Email is still
// enriched from rating history where available (connections formed purely
// via a request have no email snapshot), needed so the invite flow can
// offer "pick an existing connection" instead of retyping an address.
export async function listConnections(currentUserId) {
  const { data: rows, error } = await supabase.from('connections').select('user_a_id, user_b_id')
  if (error) throw error
  const otherIds = [
    ...new Set((rows ?? []).map((c) => (c.user_a_id === currentUserId ? c.user_b_id : c.user_a_id))),
  ]
  if (otherIds.length === 0) return []

  const ratings = await listMyPeerRatings()
  const emailById = new Map()
  const fallbackNameById = new Map()
  for (const r of ratings) {
    const gaveRating = r.rater_id === currentUserId
    const otherId = gaveRating ? r.skill_owner_id : r.rater_id
    if (!emailById.has(otherId)) {
      emailById.set(otherId, gaveRating ? r.skill_owner_email : r.rater_email)
      if (!gaveRating) fallbackNameById.set(otherId, r.rater_name)
    }
  }

  const names = await getProfileNames(otherIds)
  return otherIds.map((id) => ({
    id,
    email: emailById.get(id) || null,
    name: names[id] || fallbackNameById.get(id) || emailById.get(id) || 'Someone',
  }))
}

// Recent milestones from connections who've opted into activity_feed_visible
// (see ProfilePrivacy.jsx) -- list_connections_activity (0063) re-checks the
// connection and the opt-in itself per row, so this never needs to filter
// client-side.
export async function listConnectionsActivity(limit = 30) {
  const { data, error } = await supabase.rpc('list_connections_activity', { p_limit: limit })
  if (error) throw error
  return data ?? []
}
