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

// idempotencyKey should be generated once per attempt and reused across
// retries of that same attempt (e.g. after a network error) -- passing a
// fresh key each render/click would defeat execute_profile_transfer_plan's
// own retry-safety check.
export function executeProfileTransferPlan(planId, idempotencyKey) {
  return call('execute_profile_transfer_plan', {
    p_plan_id: planId,
    p_idempotency_key: idempotencyKey,
  })
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

const ACCOUNT_TYPE_LABELS = {
  personal: 'Personal account',
  work_sso: 'Work SSO account',
  work_managed: 'Work-managed account',
}

// Interface-translation keys for the English labels built here, so the
// components can show them in the viewer's language; the English labels
// stay alongside as the fallback.
export const ACCOUNT_TYPE_LABEL_KEYS = {
  personal: 'connectedAccounts.transferText.accountTypePersonal',
  work_sso: 'connectedAccounts.transferText.accountTypeWorkSso',
  work_managed: 'connectedAccounts.transferText.accountTypeWorkManaged',
}

const CATEGORY_LABEL_KEYS = {
  skills: 'connectedAccounts.accountProfileSummaryCard.countFieldSkills',
  experience: 'connectedAccounts.accountProfileSummaryCard.countFieldExperience',
  courses: 'connectedAccounts.accountProfileSummaryCard.countFieldCourses',
  evidence: 'connectedAccounts.accountProfileSummaryCard.countFieldEvidence',
  connections: 'connectedAccounts.accountProfileSummaryCard.countFieldConnections',
  integrations: 'connectedAccounts.accountProfileSummaryCard.countFieldIntegrations',
}

const CONFLICT_DESCRIPTION_KEYS = {
  skills: 'connectedAccounts.transferText.conflictSkills',
  courses: 'connectedAccounts.transferText.conflictCourses',
  experience: 'connectedAccounts.transferText.conflictExperience',
}

const CATEGORY_LABELS = {
  skills: 'Skills',
  experience: 'Experience',
  courses: 'Courses & training',
  evidence: 'Evidence',
  connections: 'Connections',
  integrations: 'External integrations',
}

function accountFromSummary(summary) {
  return {
    id: summary.profileId,
    email: summary.email,
    accountType: ACCOUNT_TYPE_LABELS[summary.accountType] ?? summary.accountType,
    accountTypeKey: ACCOUNT_TYPE_LABEL_KEYS[summary.accountType] ?? null,
  }
}

function conflictDescription(item) {
  if (item.domain === 'skills') return `“${item.label}” is tracked on both accounts.`
  if (item.domain === 'courses') return `“${item.label}” appears on both accounts.`
  return `“${item.label}” may describe the same experience on both accounts.`
}

export async function getProfileTransferPlan(planId) {
  const plan = await call('get_profile_transfer_plan', { p_plan_id: planId })
  const source = plan.sourceSummary
  const durable = plan.durableSummary
  const version = plan.versionHash ?? 'draft'
  return {
    id: plan.id,
    version,
    versionHash: plan.versionHash,
    status: plan.status === 'pending_approval' || plan.status === 'draft' ? 'pending' : plan.status,
    rawStatus: plan.status,
    expiresAt: plan.expiresAt,
    sourceAccount: accountFromSummary(source),
    durableAccount: accountFromSummary(durable),
    currentAccountId: plan.currentProfileId,
    categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
      key,
      label,
      labelKey: CATEGORY_LABEL_KEYS[key],
      sourceCount: source.counts?.[key] ?? null,
      durableCount: durable.counts?.[key] ?? null,
    })),
    conflicts: (plan.items ?? []).filter((item) => item.durableRecordId).map((item) => ({
      id: item.id,
      category: item.domain,
      description: conflictDescription(item),
      descriptionKey: CONFLICT_DESCRIPTION_KEYS[item.domain === 'skills' || item.domain === 'courses' ? item.domain : 'experience'],
      descriptionParams: { label: item.label },
      options: [
        {
          value: 'keep_durable',
          label: `Keep the durable account’s ${item.domain === 'skills' ? 'level' : 'record'}`,
          labelKey: item.domain === 'skills'
            ? 'connectedAccounts.transferText.keepDurableLevel'
            : 'connectedAccounts.transferText.keepDurableRecord',
        },
        {
          value: 'use_source',
          label: `Use the source account’s ${item.domain === 'skills' ? 'level' : 'record'}`,
          labelKey: item.domain === 'skills'
            ? 'connectedAccounts.transferText.useSourceLevel'
            : 'connectedAccounts.transferText.useSourceRecord',
        },
      ],
      resolution: item.action === 'unresolved' ? null : item.action,
    })),
    approvals: (plan.approvals ?? []).map((approval) => ({
      accountId: approval.profileId,
      approvedAt: approval.approvedAt,
      approvedVersion: approval.versionHash,
    })),
    events: plan.events ?? [],
  }
}
