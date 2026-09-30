import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateHeaderCache, loadHeaderCache, peekHeaderCache } from './headerCache'

beforeEach(() => invalidateHeaderCache())

describe('headerCache', () => {
  it('loads once within the TTL and serves the value to later mounts', async () => {
    const load = vi.fn().mockResolvedValue({ full_name: 'Ada' })
    expect(await loadHeaderCache('identity:u1', load, 0)).toEqual({ full_name: 'Ada' })
    expect(await loadHeaderCache('identity:u1', load, 30_000)).toEqual({ full_name: 'Ada' })
    expect(load).toHaveBeenCalledTimes(1)
    expect(peekHeaderCache('identity:u1', 30_000)).toEqual({ full_name: 'Ada' })
  })

  it('shares one in-flight request between headers mounting together', async () => {
    const load = vi.fn().mockResolvedValue([])
    await Promise.all([loadHeaderCache('portals:a', load, 0), loadHeaderCache('portals:a', load, 0)])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reloads after the TTL or after an invalidation', async () => {
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('newer').mockResolvedValueOnce('newest')
    await loadHeaderCache('identity:u1', load, 0)
    expect(await loadHeaderCache('identity:u1', load, 61_000)).toBe('newer')
    invalidateHeaderCache()
    expect(peekHeaderCache('identity:u1', 61_000)).toBeUndefined()
    expect(await loadHeaderCache('identity:u1', load, 61_000)).toBe('newest')
  })

  it("doesn't cache a failed load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ok')
    await expect(loadHeaderCache('identity:u1', load, 0)).rejects.toThrow('offline')
    expect(await loadHeaderCache('identity:u1', load, 1)).toBe('ok')
  })
})
