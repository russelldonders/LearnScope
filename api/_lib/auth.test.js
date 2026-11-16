import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifySupabaseUser } from './auth.js'

function token(sessionId) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: 'user-1', session_id: sessionId })}.signature`
}

describe('verifySupabaseUser impersonation guard', () => {
  beforeEach(() => {
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  })

  afterEach(() => vi.restoreAllMocks())

  it('accepts an ordinary authenticated session', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 })))

    await expect(verifySupabaseUser(token('10000000-0000-0000-0000-000000000001')))
      .resolves.toEqual({ id: 'user-1' })
  })

  it('rejects an impersonation token from normal API handlers', async () => {
    const row = { id: 'preview-1', target_user_id: 'user-1', ended_at: null }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([row]), { status: 200 })))

    await expect(verifySupabaseUser(token('10000000-0000-0000-0000-000000000002')))
      .resolves.toBeNull()
  })

  it('exposes the registry row only to the explicit end-session flow', async () => {
    const row = { id: 'preview-1', target_user_id: 'user-1', ended_at: null }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([row]), { status: 200 })))

    await expect(verifySupabaseUser(
      token('10000000-0000-0000-0000-000000000003'),
      { allowImpersonation: true },
    )).resolves.toEqual({ id: 'user-1', __impersonation: row })
  })
})

