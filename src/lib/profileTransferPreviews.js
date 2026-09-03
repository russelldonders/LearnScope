import { supabase } from './supabaseClient'

export async function requestProfileTransferPreview(linkId) {
  const { data, error } = await supabase.rpc('request_profile_transfer_preview', { p_link_id: linkId })
  if (error) throw error
  return data
}

export async function approveProfileTransferPreview(previewId) {
  const { error } = await supabase.rpc('approve_profile_transfer_preview', { p_preview_id: previewId })
  if (error) throw error
}

export async function cancelProfileTransferPreview(previewId) {
  const { error } = await supabase.rpc('cancel_profile_transfer_preview', { p_preview_id: previewId })
  if (error) throw error
}

export async function listProfileTransferPreviews() {
  const { data, error } = await supabase.rpc('list_my_profile_transfer_previews')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.preview_id,
    linkId: row.link_id,
    otherEmail: row.other_email,
    status: row.status,
    requestedByMe: row.requested_by_me,
    approvedByMe: row.approved_by_me,
    approvalCount: row.approval_count,
    expiresAt: row.expires_at,
  }))
}

export async function getProfileTransferComparison(previewId) {
  const { data, error } = await supabase.rpc('get_profile_transfer_comparison', { p_preview_id: previewId })
  if (error) throw error
  return data
}
