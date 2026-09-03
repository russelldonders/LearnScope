import { describe, expect, it, vi } from 'vitest'
import { loadActionSources } from './actionLoading'

describe('loadActionSources', () => {
  it('keeps successful action categories when another category fails', async () => {
    const failure = new Error('not available')
    const outcome = await loadActionSources([
      { key: 'managerInvites', label: 'manager invitations', fallback: [], load: vi.fn().mockResolvedValue([{ id: 'invite-1' }]) },
      { key: 'employerInvites', label: 'employer invitations', fallback: [], load: vi.fn().mockRejectedValue(failure) },
    ])

    expect(outcome.values).toEqual({
      managerInvites: [{ id: 'invite-1' }],
      employerInvites: [],
    })
    expect(outcome.failures).toEqual([
      { key: 'employerInvites', label: 'employer invitations', error: failure },
    ])
  })
})
