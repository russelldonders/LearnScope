import { supabase } from './supabaseClient'

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

export function createProfileTransferPlan(previewId, durableProfileId) {
  return call('create_profile_transfer_plan', {
    p_preview_id: previewId,
    p_durable_profile_id: durableProfileId,
  })
}

export function resolveProfileTransferPlanItem(planId, itemId, action) {
  return call('resolve_profile_transfer_plan_item', {
    p_plan_id: planId,
    p_item_id: itemId,
    p_action: action,
  })
}

export function submitProfileTransferPlan(planId) {
  return call('submit_profile_transfer_plan', { p_plan_id: planId })
}

export function approveProfileTransferPlan(planId, versionHash) {
  return call('approve_profile_transfer_plan', {
    p_plan_id: planId,
    p_version_hash: versionHash,
  })
}

export function withdrawProfileTransferPlanApproval(planId) {
  return call('withdraw_profile_transfer_plan_approval', { p_plan_id: planId })
}

export function cancelProfileTransferPlan(planId) {
  return call('cancel_profile_transfer_plan', { p_plan_id: planId })
}

export async function listProfileTransferPlans() {
  const rows = await call('list_my_profile_transfer_plans')
  return (rows ?? []).map((row) => ({
    id: row.plan_id,
    previewId: row.preview_id,
    linkId: row.link_id,
    status: row.status,
    versionHash: row.version_hash,
    sourceProfile: { id: row.source_profile_id, email: row.source_email },
    durableProfile: { id: row.durable_profile_id, email: row.durable_email },
    approvedByMe: row.approved_by_me,
    approvalCount: row.approval_count,
    expiresAt: row.expires_at,
  }))
}

export function getProfileTransferPlan(planId) {
  return call('get_profile_transfer_plan', { p_plan_id: planId })
}
