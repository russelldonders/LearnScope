import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

const {
  createAccountLinkInvitation,
  redeemAccountLinkInvitation,
  revokeVerifiedAccountLink,
  listVerifiedAccountLinks,
} = await import('./accountLinks')

describe('account links service', () => {
  beforeEach(() => rpc.mockReset())

  it('maps the one-time invitation result', async () => {
    rpc.mockResolvedValue({ data: [{ invitation_id: 'invite-1', token: 'secret', expires_at: 'soon' }], error: null })
    await expect(createAccountLinkInvitation('personal@example.com')).resolves.toEqual({
      id: 'invite-1', token: 'secret', expiresAt: 'soon',
    })
    expect(rpc).toHaveBeenCalledWith('create_account_link_invitation', { p_target_email: 'personal@example.com' })
  })

  it('redeems a token without performing a client-side merge', async () => {
    rpc.mockResolvedValue({ data: 'link-1', error: null })
    await expect(redeemAccountLinkInvitation('secret')).resolves.toBe('link-1')
    expect(rpc).toHaveBeenCalledWith('redeem_account_link_invitation', { p_token: 'secret' })
  })

  it('surfaces database authorization failures', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('Sign in with the invited email address') })
    await expect(redeemAccountLinkInvitation('wrong')).rejects.toThrow('Sign in with the invited email address')
  })

  it('revokes the relationship through its narrow RPC', async () => {
    rpc.mockResolvedValue({ error: null })
    await revokeVerifiedAccountLink('link-1')
    expect(rpc).toHaveBeenCalledWith('revoke_verified_account_link', { p_link_id: 'link-1' })
  })

  it('maps verified links without exposing auth internals', async () => {
    rpc.mockResolvedValue({ data: [{ link_id: 'link-1', other_email: 'work@example.com', other_account_type: 'work_sso', status: 'active', verified_at: 'today' }], error: null })
    await expect(listVerifiedAccountLinks()).resolves.toEqual([{
      id: 'link-1', email: 'work@example.com', accountType: 'work_sso', status: 'active', verifiedAt: 'today',
    }])
  })
})
