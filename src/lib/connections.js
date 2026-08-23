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

// Opens WhatsApp (the app on mobile, web/desktop WhatsApp otherwise) with a
// pre-filled message -- just a wa.me deep link, no API key or auth needed.
export function whatsappShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
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

// The general-purpose "share this however you like" link shown as soon as
// the invite modal opens (see InviteRaterModal), as opposed to createInvite,
// which always mints a new row -- reused here so repeatedly opening/closing
// the modal doesn't leave a trail of unused pending invites behind. There's
// no unique index to lean on for this (connection_invites_unique_pending_idx
// only applies once an email is attached), so the dedup happens here.
export async function getOrCreateShareLink(skillId, inviterId) {
  const { data: existing, error: selectError } = await supabase
    .from('connection_invites')
    .select('id, share_code')
    .eq('skill_id', skillId)
    .eq('inviter_id', inviterId)
    .eq('status', 'pending')
    .is('invitee_email', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selectError) throw selectError
  if (existing) return { ...existing, url: `${window.location.origin}/rate/${existing.share_code}` }
  return createInvite(skillId, null, inviterId)
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

// Skills both users track from the shared library catalog (see
// 0013_skill_library.sql) -- library_skill_id ties a personal skill row to
// the reusable catalog entry, so two people's rows count as "the same
// skill" when they reference the same library_skill_id, not just a matching
// name. RLS on skills only returns a connection's rows when they've made
// that skill visible_on_profile and opted skills_profile_visible on (see
// "Connections can view visible skills profiles", 0051) -- so like
// SkillsProfile.jsx, this only ever counts skills the other person has
// chosen to show, never their private tracking list.
export async function getSharedSkillCounts(userId, otherUserIds) {
  const ids = [...new Set(otherUserIds)].filter((id) => id && id !== userId)
  if (ids.length === 0) return {}

  const [{ data: mine, error: mineError }, { data: theirs, error: theirsError }] = await Promise.all([
    supabase.from('skills').select('library_skill_id').eq('user_id', userId).not('library_skill_id', 'is', null),
    supabase.from('skills').select('user_id, library_skill_id').in('user_id', ids).not('library_skill_id', 'is', null),
  ])
  if (mineError) throw mineError
  if (theirsError) throw theirsError

  const mySkillIds = new Set((mine ?? []).map((s) => s.library_skill_id))
  const theirSkillIdsByUser = new Map()
  for (const row of theirs ?? []) {
    if (!theirSkillIdsByUser.has(row.user_id)) theirSkillIdsByUser.set(row.user_id, new Set())
    theirSkillIdsByUser.get(row.user_id).add(row.library_skill_id)
  }

  const counts = {}
  for (const id of ids) counts[id] = 0
  for (const [otherId, idSet] of theirSkillIdsByUser) {
    let count = 0
    for (const libId of idSet) if (mySkillIds.has(libId)) count++
    counts[otherId] = count
  }
  return counts
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
