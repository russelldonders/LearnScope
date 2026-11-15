import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  verifySupabaseUser: vi.fn(),
  consumeQuota: vi.fn(),
  checkOrganisationAccess: vi.fn(),
  insertUsage: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mocks.createMessage }
  },
}))
vi.mock('./auth.js', () => ({ verifySupabaseUser: mocks.verifySupabaseUser }))
vi.mock('./quota.js', () => ({
  consumeQuota: mocks.consumeQuota,
  sendQuotaExceeded: vi.fn(),
}))
vi.mock('./supabaseAdmin.js', () => ({
  supabaseAdmin: () => ({
    rpc: mocks.checkOrganisationAccess,
    from: () => ({ insert: mocks.insertUsage }),
  }),
}))

import generateCourseDraftHandler from './generateCourseDraftHandler.js'

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

const validBody = {
  topic: 'Safe lifting',
  audience: 'New starters',
  outcomes: 'Plan and complete a safe lift',
  sectionCount: 1,
  pagesPerSection: 1,
}

describe('generateCourseDraftHandler errors', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    mocks.createMessage.mockReset()
    mocks.verifySupabaseUser.mockReset().mockResolvedValue({ id: 'user-1' })
    mocks.consumeQuota.mockReset().mockResolvedValue(true)
    mocks.checkOrganisationAccess.mockReset().mockResolvedValue({ data: true, error: null })
    mocks.insertUsage.mockReset().mockResolvedValue({ error: null })
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('reports a missing server credential explicitly', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const res = response()

    await generateCourseDraftHandler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: validBody }, res)

    expect(res).toMatchObject({
      statusCode: 503,
      body: { error: 'Course generation is not configured on this environment.' },
    })
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it('turns AI authentication failures into an actionable response', async () => {
    process.env.ANTHROPIC_API_KEY = 'configured-for-test'
    mocks.createMessage.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }))
    const res = response()

    await generateCourseDraftHandler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: validBody }, res)

    expect(res).toMatchObject({
      statusCode: 503,
      body: { error: 'Course generation could not authenticate with the AI service.' },
    })
  })

  it('rejects organisation attribution the caller cannot access', async () => {
    process.env.ANTHROPIC_API_KEY = 'configured-for-test'
    mocks.checkOrganisationAccess.mockResolvedValue({ data: false, error: null })
    const res = response()

    await generateCourseDraftHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { ...validBody, organisationId: '79000000-0000-4000-8000-000000000010' },
    }, res)

    expect(res).toMatchObject({
      statusCode: 403,
      body: { error: 'You cannot generate training for this organisation.' },
    })
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it('restricts skill-series generation to platform administrators', async () => {
    process.env.ANTHROPIC_API_KEY = 'configured-for-test'
    mocks.checkOrganisationAccess.mockResolvedValue({ data: false, error: null })
    const res = response()

    await generateCourseDraftHandler(
      { method: 'POST', headers: { authorization: 'Bearer token' }, body: validBody },
      res,
      { requirePlatformAdmin: true, feature: 'skill_level_course_generation' },
    )

    expect(res).toMatchObject({
      statusCode: 403,
      body: { error: 'Platform administrator access required.' },
    })
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it('identifies requests rejected by the AI provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'configured-for-test'
    mocks.createMessage.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }))
    const res = response()

    await generateCourseDraftHandler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: validBody }, res)

    expect(res).toMatchObject({
      statusCode: 502,
      body: { error: 'The AI service rejected the course request format.' },
    })
  })

})
