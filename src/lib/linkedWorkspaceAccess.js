import { supabase } from './supabaseClient'

export async function requestLinkedWorkspaceAccess(linkId) {
  const { data, error } = await supabase.rpc('request_linked_workspace_access', { p_link_id: linkId })
  if (error) throw error
  return data
}

export async function acceptLinkedWorkspaceAccess(requestId) {
  const { error } = await supabase.rpc('accept_linked_workspace_access', { p_request_id: requestId })
  if (error) throw error
}

export async function declineLinkedWorkspaceAccess(requestId) {
  const { error } = await supabase.rpc('decline_linked_workspace_access', { p_request_id: requestId })
  if (error) throw error
}

export async function cancelLinkedWorkspaceAccessRequest(requestId) {
  const { error } = await supabase.rpc('cancel_linked_workspace_access_request', { p_request_id: requestId })
  if (error) throw error
}

export async function revokeGrantedWorkspaceAccess(linkId) {
  const { error } = await supabase.rpc('revoke_granted_workspace_access', { p_link_id: linkId })
  if (error) throw error
}

export async function renounceLinkedWorkspaceAccess(linkId) {
  const { error } = await supabase.rpc('renounce_linked_workspace_access', { p_link_id: linkId })
  if (error) throw error
}

export async function listLinkedWorkspaceAccessRequests() {
  const { data, error } = await supabase.rpc('list_my_linked_workspace_access_requests')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.request_id,
    linkId: row.link_id,
    email: row.other_email,
    direction: row.direction,
    status: row.status,
    createdAt: row.created_at,
  }))
}

export async function listLinkedWorkspaceAccessGrants() {
  const { data, error } = await supabase.rpc('list_my_linked_workspace_access_grants')
  if (error) throw error
  return (data ?? []).map((row) => ({
    linkId: row.link_id,
    email: row.other_email,
    direction: row.direction,
    grantedAt: row.granted_at,
  }))
}
