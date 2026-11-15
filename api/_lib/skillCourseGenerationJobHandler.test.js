import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyUser: vi.fn(),
  consumeQuota: vi.fn(),
  createMessage: vi.fn(),
  waitUntil: vi.fn(),
  rpc: vi.fn(),
  insertUsage: vi.fn(),
}))

vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }))
vi.mock('./auth.js', () => ({ verifySupabaseUser: mocks.verifyUser }))
vi.mock('./quota.js', () => ({ consumeQuota: mocks.consumeQuota, sendQuotaExceeded: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mocks.createMessage }
  },
}))

function builder(table) {
  let operation = 'select'
  return {
    select() { operation = 'select'; return this },
    insert() { operation = 'insert'; return this },
    update() { operation = 'update'; return this },
    delete() { operation = 'delete'; return this },
    eq() { return this },
    in() { return this },
    lt() { return this },
    maybeSingle() {
      if (table === 'organisations') return Promise.resolve({ data: { id: '79000000-0000-4000-8000-000000000010' }, error: null })
      if (table === 'skill_library') return Promise.resolve({ data: { id: '79000000-0000-4000-8000-000000000020' }, error: null })
      if (table === 'skill_course_generation_jobs' && operation === 'update') return Promise.resolve({ data: { id: '79000000-0000-4000-8000-000000000030' }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    single() {
      if (table === 'skill_course_generation_jobs' && operation === 'select') {
        return Promise.resolve({ data: { id: '79000000-0000-4000-8000-000000000030' }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    then(resolve) { resolve({ data: null, error: null }) },
  }
}

vi.mock('./supabaseAdmin.js', () => ({
  supabaseAdmin: () => ({
    rpc: mocks.rpc,
    from: (table) => table === 'ai_usage_events'
      ? { insert: mocks.insertUsage }
      : builder(table),
  }),
}))

import skillCourseGenerationJobHandler from './skillCourseGenerationJobHandler.js'

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

describe('skillCourseGenerationJobHandler', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'configured-for-test'
    mocks.verifyUser.mockReset().mockResolvedValue({ id: '79000000-0000-4000-8000-000000000001' })
    mocks.consumeQuota.mockReset().mockResolvedValue(true)
    mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null })
    mocks.waitUntil.mockReset()
    mocks.createMessage.mockReset().mockReturnValue(new Promise(() => {}))
    mocks.insertUsage.mockReset().mockResolvedValue({ error: null })
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('returns a job id without waiting for the long AI request', async () => {
    const res = response()
    await skillCourseGenerationJobHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      query: {},
      body: {
        topic: 'Coaching — Aware',
        audience: 'New coaches',
        outcomes: 'Understand the coaching cycle',
        sectionCount: 2,
        pagesPerSection: 2,
        organisationId: '79000000-0000-4000-8000-000000000010',
        skillId: '79000000-0000-4000-8000-000000000020',
        level: 2,
      },
    }, res)

    expect(res).toMatchObject({
      statusCode: 202,
      body: { jobId: '79000000-0000-4000-8000-000000000030' },
    })
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1)
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })
})
