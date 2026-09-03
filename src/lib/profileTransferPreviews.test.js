import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))
const service = await import('./profileTransferPreviews')

describe('profile transfer preview service', () => {
  beforeEach(() => rpc.mockReset())

  it('requests a consent-gated preview', async () => {
    rpc.mockResolvedValue({ data: 'preview-1', error: null })
    await expect(service.requestProfileTransferPreview('link-1')).resolves.toBe('preview-1')
    expect(rpc).toHaveBeenCalledWith('request_profile_transfer_preview', { p_link_id: 'link-1' })
  })

  it('maps preview consent state', async () => {
    rpc.mockResolvedValue({ data: [{ preview_id: 'preview-1', link_id: 'link-1', other_email: 'work@example.com', status: 'pending', requested_by_me: false, approved_by_me: false, approval_count: 1, expires_at: 'later' }], error: null })
    await expect(service.listProfileTransferPreviews()).resolves.toEqual([{
      id: 'preview-1', linkId: 'link-1', otherEmail: 'work@example.com', status: 'pending',
      requestedByMe: false, approvedByMe: false, approvalCount: 1, expiresAt: 'later',
    }])
  })

  it('uses narrow approval, cancellation and comparison RPCs', async () => {
    rpc.mockResolvedValue({ data: {}, error: null })
    await service.approveProfileTransferPreview('preview-1')
    await service.cancelProfileTransferPreview('preview-1')
    await service.getProfileTransferComparison('preview-1')
    expect(rpc.mock.calls).toEqual([
      ['approve_profile_transfer_preview', { p_preview_id: 'preview-1' }],
      ['cancel_profile_transfer_preview', { p_preview_id: 'preview-1' }],
      ['get_profile_transfer_comparison', { p_preview_id: 'preview-1' }],
    ])
  })

  it('adapts the comparison projection to the controlled UI contract', async () => {
    rpc.mockResolvedValue({ data: {
      profiles: [
        { profileId: 'profile-a', email: 'a@example.com', accountType: 'personal', counts: { skills: 2 } },
        { profileId: 'profile-b', email: 'b@example.com', accountType: 'work_sso', counts: { skills: 1 } },
      ],
      conflicts: { skills: [{ name: 'Coaching', levelA: 4, levelB: 3 }], courses: [{ title: 'Safety' }], experience: [] },
    }, error: null })
    await expect(service.getProfileTransferComparison('preview-1')).resolves.toMatchObject({
      accountA: { id: 'profile-a', accountType: 'Personal account' },
      accountB: { id: 'profile-b', accountType: 'Work SSO account' },
      conflicts: { duplicateSkills: [{ name: 'Coaching', levelA: 4, levelB: 3 }], overlappingCourses: [{ title: 'Safety' }] },
    })
  })
})
