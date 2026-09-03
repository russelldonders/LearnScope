import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))
const service = await import('./profileTransferPlans')

describe('profile transfer plan service', () => {
  beforeEach(() => rpc.mockReset())

  it('creates a plan from an approved preview and explicit durable profile', async () => {
    rpc.mockResolvedValue({ data: 'plan-1', error: null })
    await expect(service.createProfileTransferPlan('preview-1', 'profile-a')).resolves.toBe('plan-1')
    expect(rpc).toHaveBeenCalledWith('create_profile_transfer_plan', {
      p_preview_id: 'preview-1', p_durable_profile_id: 'profile-a',
    })
  })

  it('uses narrow RPCs for resolution and exact-version approval', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await service.resolveProfileTransferPlanItem('plan-1', 'item-1', 'keep_durable')
    await service.submitProfileTransferPlan('plan-1')
    await service.approveProfileTransferPlan('plan-1', 'hash-1')
    await service.withdrawProfileTransferPlanApproval('plan-1')
    await service.cancelProfileTransferPlan('plan-1')
    expect(rpc.mock.calls).toEqual([
      ['resolve_profile_transfer_plan_item', { p_plan_id: 'plan-1', p_item_id: 'item-1', p_action: 'keep_durable' }],
      ['submit_profile_transfer_plan', { p_plan_id: 'plan-1' }],
      ['approve_profile_transfer_plan', { p_plan_id: 'plan-1', p_version_hash: 'hash-1' }],
      ['withdraw_profile_transfer_plan_approval', { p_plan_id: 'plan-1' }],
      ['cancel_profile_transfer_plan', { p_plan_id: 'plan-1' }],
    ])
  })

  it('maps plan summaries for the controlled review UI', async () => {
    rpc.mockResolvedValue({ data: [{
      plan_id: 'plan-1', preview_id: 'preview-1', link_id: 'link-1', status: 'pending_approval',
      version_hash: 'hash-1', source_profile_id: 'source', source_email: 'work@example.com',
      durable_profile_id: 'durable', durable_email: 'personal@example.com', approved_by_me: false,
      approval_count: 1, expires_at: 'later',
    }], error: null })
    await expect(service.listProfileTransferPlans()).resolves.toEqual([{
      id: 'plan-1', previewId: 'preview-1', linkId: 'link-1', status: 'pending_approval',
      versionHash: 'hash-1', sourceProfile: { id: 'source', email: 'work@example.com' },
      durableProfile: { id: 'durable', email: 'personal@example.com' }, approvedByMe: false,
      approvalCount: 1, expiresAt: 'later',
    }])
  })

  it('surfaces authorization errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('Transfer plan not found') })
    await expect(service.getProfileTransferPlan('other-plan')).rejects.toThrow('Transfer plan not found')
  })

  it('adapts a database plan to the controlled review UI contract', async () => {
    rpc.mockResolvedValue({ data: {
      id: 'plan-1', status: 'pending_approval', versionHash: 'hash-1', expiresAt: 'later',
      currentProfileId: 'durable',
      sourceSummary: { profileId: 'source', email: 'work@example.com', accountType: 'work_sso', counts: { skills: 2, courses: 1 } },
      durableSummary: { profileId: 'durable', email: 'personal@example.com', accountType: 'personal', counts: { skills: 4, courses: 3 } },
      items: [{ id: 'item-1', domain: 'skills', label: 'SQL', durableRecordId: 'skill-2', action: 'use_source' }],
      approvals: [{ profileId: 'source', approvedAt: 'today', versionHash: 'hash-1' }],
      events: [{ type: 'submitted' }],
    }, error: null })

    await expect(service.getProfileTransferPlan('plan-1')).resolves.toMatchObject({
      id: 'plan-1', version: 'hash-1', rawStatus: 'pending_approval', status: 'pending',
      currentAccountId: 'durable',
      sourceAccount: { id: 'source', accountType: 'Work SSO account' },
      durableAccount: { id: 'durable', accountType: 'Personal account' },
      conflicts: [{ id: 'item-1', resolution: 'use_source' }],
      approvals: [{ accountId: 'source', approvedVersion: 'hash-1' }],
    })
  })
})
