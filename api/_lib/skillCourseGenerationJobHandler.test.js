import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyUser: vi.fn(),
  consumeQuota: vi.fn(),
  createMessage: vi.fn(),
  waitUntil: vi.fn(),
  rpc: vi.fn(),
  insertUsage: vi.fn(),
  claimJob: false,
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
  let wasUpdated = false
  return {
    select() { operation = 'select'; return this },
    insert() { operation = 'insert'; return this },
    update() { operation = 'update'; wasUpdated = true; return this },
    delete() { operation = 'delete'; return this },
    eq() { return this },
    in() { return this },
    lt() { return this },
    gt() { return this },
    maybeSingle() {
      if (table === 'organisations') return Promise.resolve({ data: { id: '79000000-0000-4000-8000-000000000010' }, error: null })
      if (table === 'skill_library') return Promise.resolve({ data: { id: '79000000-0000-4000-8000-000000000020' }, error: null })
      if (table === 'skill_course_generation_jobs' && wasUpdated && mocks.claimJob) return Promise.resolve({ data: { id: '79000000-0000-4000-8000-000000000030' }, error: null })
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

import { buildCourseDraftRequest } from './courseDraft.js'
import skillCourseGenerationJobHandler, { failStalledJobs, generationErrorMessage, runGenerationJob } from './skillCourseGenerationJobHandler.js'

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
    mocks.claimJob = false
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

describe('failStalledJobs', () => {
  function recorder() {
    const calls = []
    const chain = {
      update(values) { calls.push(['update', values]); return chain },
      eq(column, value) { calls.push(['eq', column, value]); return chain },
      lt(column, value) { calls.push(['lt', column, value]); return chain },
      then(resolve) { resolve({ error: null }) },
    }
    return { calls, admin: { from: (table) => { calls.push(['from', table]); return chain } } }
  }

  it('fails only jobs still running six minutes after their last update', async () => {
    const { calls, admin } = recorder()
    const now = Date.parse('2026-11-15T12:00:00Z')
    await failStalledJobs(admin, { now })
    expect(calls).toContainEqual(['from', 'skill_course_generation_jobs'])
    expect(calls).toContainEqual(['eq', 'status', 'running'])
    expect(calls).toContainEqual(['lt', 'updated_at', '2026-11-15T11:54:00.000Z'])
    const [, values] = calls.find(([op]) => op === 'update')
    expect(values).toMatchObject({ status: 'failed', completed_at: '2026-11-15T12:00:00.000Z' })
    expect(values.error_message).toMatch(/took too long/)
    expect(calls.some(([op, column]) => op === 'eq' && column === 'id')).toBe(false)
  })

  it('can be limited to one job', async () => {
    const { calls, admin } = recorder()
    await failStalledJobs(admin, { jobId: 'job-1' })
    expect(calls).toContainEqual(['eq', 'id', 'job-1'])
  })
})

describe('generationErrorMessage', () => {
  it('says what went wrong rather than a generic failure', () => {
    expect(generationErrorMessage(Object.assign(new Error('x'), { userMessage: 'The AI wrote 4 sections instead of 5. The course wasn’t saved. Try again.' })))
      .toBe('The AI wrote 4 sections instead of 5. The course wasn’t saved. Try again.')
    expect(generationErrorMessage({ status: 529 })).toBe('The AI service is overloaded right now. Try again in a minute.')
    expect(generationErrorMessage({ status: 500 })).toBe('The AI service had an error. Try again.')
    expect(generationErrorMessage(new SyntaxError('Unexpected end of JSON'))).toBe('The AI’s reply couldn’t be read as a course. Try again.')
    expect(generationErrorMessage({ status: 429 })).toMatch(/busy/)
  })
})

describe('assessment correction', () => {
  function generatedCourse(questionCount) {
    const question = (index) => ({
      type: 'test_question', content: `Question ${index + 1}?`, secondaryContent: 'Review the course material.',
      level: 2, variant: 'info', align: 'left', layout: 'single', unit: '', points: 1, tolerance: 0,
      items: [
        { label: 'Correct', detail: '', value: 0, correct: true },
        { label: 'Incorrect', detail: '', value: 0, correct: false },
      ],
    })
    return {
      name: 'Coaching', synopsis: 'Learn coaching.',
      sections: [
        { title: 'Learning', instructions: '', pages: [{ title: 'Introduction', blocks: [{ type: 'text', content: 'Learn the essentials.', secondaryContent: '', level: 2, variant: 'info', align: 'left', layout: 'none', unit: '', points: 1, tolerance: 0, items: [] }] }] },
        { title: 'Final test', instructions: '', pages: [{ title: 'Final test', blocks: Array.from({ length: questionCount }, (_, index) => question(index)) }] },
      ],
    }
  }

  it('automatically regenerates a course when the test has too few questions', async () => {
    mocks.claimJob = true
    const request = buildCourseDraftRequest({
      topic: 'Coaching', audience: 'New coaches', outcomes: 'Understand coaching',
      sectionCount: 2, pagesPerSection: 1, elements: ['knowledge_check'],
      assessmentEnabled: true, assessmentQuestionCount: 10, assessmentPassMark: 70,
      assessmentPointsPerQuestion: 1, assessmentQuestionTypes: ['single'],
    })
    mocks.createMessage
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(generatedCourse(6)) }], usage: {} })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(generatedCourse(10)) }], usage: {} })

    await runGenerationJob({
      jobId: '79000000-0000-4000-8000-000000000030', request,
      userId: '79000000-0000-4000-8000-000000000001', organisationId: '79000000-0000-4000-8000-000000000010',
    })

    expect(mocks.createMessage).toHaveBeenCalledTimes(2)
    expect(mocks.createMessage.mock.calls[1][0].messages[0].content).toContain('previous course was rejected')
    expect(mocks.createMessage.mock.calls[1][0].messages[0].content).toContain('exactly 10 test_question blocks')
  })
})
