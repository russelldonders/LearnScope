import { supabase } from './supabaseClient'

// Pending organisation_members rows addressed to the current user -- an org
// admin invited them as staff (0070), and they haven't accepted or declined
// yet. Surfaced on Connections alongside connection/validation requests,
// the app's existing "things waiting on you" hub.
export async function listMyPendingOrgInvites(userId) {
  const { data, error } = await supabase
    .from('organisation_members')
    .select('id, role, created_at, organisations(id, name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function decideOrgInvite(memberId, accept) {
  const { error } = await supabase.rpc('decide_org_invite', { p_member_id: memberId, p_accept: accept })
  if (error) throw error
}
