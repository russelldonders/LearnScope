import { supabase } from './supabaseClient'

// Learner-initiated, short-lived, token-based profile share link -- lets a
// learner send a URL to anyone (no LearnScope account required to view it).
// Mirrors src/lib/connections.js's getInvitePreview/acceptInviteAndRate
// shape: thin wrappers around the security definer RPCs in
// 20260902300000_profile_share_links.sql.

export function profileShareLinkUrl(token) {
  return `${window.location.origin}/shared/${token}`
}

// create_profile_share_link validates ownership of skillIds and the expiry
// window (future, capped at 90 days) server-side -- see the migration for
// the full validation. Returns the created row, including its generated
// token, needed to build the shareable URL.
export async function createProfileShareLink({ shareSkills, shareExperience, skillIds = [], expiresAt, label }) {
  const { data, error } = await supabase.rpc('create_profile_share_link', {
    p_share_skills: shareSkills,
    p_share_experience: shareExperience,
    p_skill_ids: skillIds,
    p_expires_at: expiresAt,
    p_label: label || null,
  })
  if (error) throw error
  return data
}

// Plain RLS-scoped select -- "Learners can view their own share links" only
// ever returns the caller's own rows, so no need to filter by userId here,
// but it's accepted for symmetry with the rest of this file's callers.
export async function listMyProfileShareLinks() {
  const { data, error } = await supabase
    .from('profile_share_links')
    .select('id, token, label, share_skills, share_experience, expires_at, revoked_at, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function revokeProfileShareLink(shareLinkId) {
  const { error } = await supabase.rpc('revoke_profile_share_link', { p_share_link_id: shareLinkId })
  if (error) throw error
}

// The public read -- get_shared_profile is granted to anon, so this must
// work for a logged-out caller too. supabase-js's .rpc() always calls
// through the anon-keyed client regardless of session, so no special
// handling is needed here beyond just calling it.
export async function getSharedProfile(token) {
  const { data, error } = await supabase.rpc('get_shared_profile', { p_token: token })
  if (error) throw error
  return data ?? null
}
