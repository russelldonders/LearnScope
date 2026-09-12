import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabaseClient', () => ({ supabase: { rpc } }))

const { getMyAccountOwnership } = await import('./accountOwnership')

describe('accountOwnership service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null for a personal (self-signup) account', async () => {
    rpc.mockResolvedValue({ data: [{ account_type: 'personal' }], error: null })
    expect(await getMyAccountOwnership()).toBeNull()
  })

  it('returns null when the RPC finds no row at all', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await getMyAccountOwnership()).toBeNull()
  })

  it('maps an employer-provisioned account, including currently active employers', async () => {
    rpc.mockResolvedValue({
      data: [{
        account_type: 'work_managed',
        origin_employer_name: 'Leeds United',
        personal_ownership_claimed_at: null,
        active_employer_names: ['Leeds United', 'Acme Corp'],
      }],
      error: null,
    })
    expect(await getMyAccountOwnership()).toEqual({
      originEmployerName: 'Leeds United',
      personalOwnershipClaimedAt: null,
      activeEmployerNames: ['Leeds United', 'Acme Corp'],
    })
  })

  it('surfaces the origin employer even if it is no longer among the active ones', async () => {
    rpc.mockResolvedValue({
      data: [{
        account_type: 'work_managed',
        origin_employer_name: 'Former Employer Ltd',
        personal_ownership_claimed_at: '2026-09-01T00:00:00Z',
        active_employer_names: [],
      }],
      error: null,
    })
    const result = await getMyAccountOwnership()
    expect(result.originEmployerName).toBe('Former Employer Ltd')
    expect(result.activeEmployerNames).toEqual([])
    expect(result.personalOwnershipClaimedAt).toBe('2026-09-01T00:00:00Z')
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Not authorised' } })
    await expect(getMyAccountOwnership()).rejects.toEqual({ message: 'Not authorised' })
  })
})
