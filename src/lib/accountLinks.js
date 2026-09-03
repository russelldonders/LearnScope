import { supabase } from './supabaseClient'

const ACCOUNT_LINK_FRAGMENT_KEY = 'account-link'

export function buildAccountLinkUrl(token, origin = window.location.origin) {
  const fragment = new URLSearchParams({ [ACCOUNT_LINK_FRAGMENT_KEY]: token })
  return `${origin}/profile/connected-accounts#${fragment.toString()}`
}

export function readAccountLinkToken(hash = window.location.hash) {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(fragment).get(ACCOUNT_LINK_FRAGMENT_KEY)
}

export async function createAccountLinkInvitation(targetEmail) {
  const { data, error } = await supabase.rpc('create_account_link_invitation', {
    p_target_email: targetEmail,
  })
  if (error) throw error
  const invitation = data?.[0]
  if (!invitation) throw new Error('Could not create an account link invitation.')
  return {
    id: invitation.invitation_id,
    token: invitation.token,
    expiresAt: invitation.expires_at,
  }
}

export async function redeemAccountLinkInvitation(token) {
  const { data, error } = await supabase.rpc('redeem_account_link_invitation', {
    p_token: token,
  })
  if (error) throw error
  return data
}

export async function revokeVerifiedAccountLink(linkId) {
  const { error } = await supabase.rpc('revoke_verified_account_link', {
    p_link_id: linkId,
  })
  if (error) throw error
}

export async function listVerifiedAccountLinks() {
  const { data, error } = await supabase.rpc('list_my_verified_account_links')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.link_id,
    email: row.other_email,
    accountType: row.other_account_type,
    status: row.status,
    verifiedAt: row.verified_at,
  }))
}
