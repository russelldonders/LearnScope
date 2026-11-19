import { describe, expect, it, vi } from 'vitest'
import { fetchRetryingReads, isRetryableRead } from './networkRetry'

const BASE = 'https://example.supabase.co'
const noWait = { wait: () => Promise.resolve() }
const loadFailed = () => new TypeError('Load failed')

describe('isRetryableRead', () => {
  it('retries table reads and list/count functions, never writes', () => {
    expect(isRetryableRead(`${BASE}/rest/v1/connections?select=*`, { method: 'GET' })).toBe(true)
    expect(isRetryableRead(`${BASE}/rest/v1/connections`, {})).toBe(true)
    expect(isRetryableRead(`${BASE}/rest/v1/rpc/list_connections_activity`, { method: 'POST' })).toBe(true)
    expect(isRetryableRead(`${BASE}/rest/v1/rpc/count_skill_trackers`, { method: 'POST' })).toBe(true)
    expect(isRetryableRead(`${BASE}/rest/v1/rpc/get_learner_plan_share_link`, { method: 'POST' })).toBe(false)
    expect(isRetryableRead(`${BASE}/rest/v1/rpc/create_manager_team`, { method: 'POST' })).toBe(false)
    expect(isRetryableRead(`${BASE}/rest/v1/skills`, { method: 'POST' })).toBe(false)
    expect(isRetryableRead(`${BASE}/rest/v1/skills?id=eq.1`, { method: 'PATCH' })).toBe(false)
  })
})

describe('fetchRetryingReads', () => {
  it('tries a dropped read again and returns once it gets through', async () => {
    const response = new Response('[]')
    const doFetch = vi.fn().mockRejectedValueOnce(loadFailed()).mockResolvedValueOnce(response)
    await expect(fetchRetryingReads(doFetch, `${BASE}/rest/v1/connections`, {}, noWait)).resolves.toBe(response)
    expect(doFetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after its retries', async () => {
    const doFetch = vi.fn().mockRejectedValue(loadFailed())
    await expect(fetchRetryingReads(doFetch, `${BASE}/rest/v1/connections`, {}, noWait)).rejects.toThrow('Load failed')
    expect(doFetch).toHaveBeenCalledTimes(3)
  })

  it('never repeats a write, which may already have been saved', async () => {
    const doFetch = vi.fn().mockRejectedValue(loadFailed())
    await expect(fetchRetryingReads(doFetch, `${BASE}/rest/v1/skills`, { method: 'POST' }, noWait)).rejects.toThrow()
    expect(doFetch).toHaveBeenCalledTimes(1)
  })

  it('leaves HTTP errors and cancelled requests alone', async () => {
    const notFound = new Response('', { status: 404 })
    const doFetch = vi.fn().mockResolvedValue(notFound)
    await expect(fetchRetryingReads(doFetch, `${BASE}/rest/v1/connections`, {}, noWait)).resolves.toBe(notFound)
    expect(doFetch).toHaveBeenCalledTimes(1)

    const controller = new AbortController()
    controller.abort()
    const aborted = vi.fn().mockRejectedValue(loadFailed())
    await expect(fetchRetryingReads(aborted, `${BASE}/rest/v1/connections`, { signal: controller.signal }, noWait)).rejects.toThrow()
    expect(aborted).toHaveBeenCalledTimes(1)
  })
})
