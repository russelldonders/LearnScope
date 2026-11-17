import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generateCourseDraftHandler, verifySupabaseUser, supabaseAdmin, buildScormCoursePackage } = vi.hoisted(() => ({
  generateCourseDraftHandler: vi.fn(),
  verifySupabaseUser: vi.fn(),
  supabaseAdmin: vi.fn(),
  buildScormCoursePackage: vi.fn(),
}))

vi.mock('./generateCourseDraftHandler.js', () => ({
  default: generateCourseDraftHandler,
}))
vi.mock('./auth.js', () => ({ verifySupabaseUser }))
vi.mock('./supabaseAdmin.js', () => ({ supabaseAdmin }))
vi.mock('./scormExport.js', () => ({ buildScormCoursePackage }))

import handler from '../admin/actions.js'

describe('admin action dispatcher', () => {
  beforeEach(() => {
    generateCourseDraftHandler.mockReset()
    verifySupabaseUser.mockReset()
    supabaseAdmin.mockReset()
    buildScormCoursePackage.mockReset()
  })

  it('dispatches the course-generation route before admin authentication', async () => {
    const req = { query: { ai: 'generate-course-draft' }, method: 'POST', headers: {} }
    const res = {}

    await handler(req, res)

    expect(generateCourseDraftHandler).toHaveBeenCalledOnce()
    expect(generateCourseDraftHandler).toHaveBeenCalledWith(req, res)
  })

  it('exports a published course only for an admin of its organisation', async () => {
    verifySupabaseUser.mockResolvedValue({ id: 'user-1' })
    const course = {
      id: 'course-1',
      name: 'First aid',
      organisation_id: 'org-1',
      status: 'approved',
      is_current_published: true,
      organisations: { status: 'active' },
    }
    const query = (result) => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: result, error: null }) }
      return chain
    }
    supabaseAdmin.mockReturnValue({
      from: vi.fn((table) => query(table === 'course_catalogue' ? course : { id: 'membership-1' })),
    })
    buildScormCoursePackage.mockResolvedValue({ buffer: Buffer.from('zip'), fileName: 'First-aid-SCORM-1.2.zip' })
    const res = responseDouble()
    const req = {
      query: {},
      method: 'POST',
      headers: { authorization: 'Bearer token', host: 'learn.example', 'x-forwarded-proto': 'https' },
      body: { action: 'exportCourseScorm', courseId: 'course-1' },
    }

    await handler(req, res)

    expect(buildScormCoursePackage).toHaveBeenCalledWith(course, expect.stringMatching(/^https:\/\/learn\.example/))
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith(Buffer.from('zip'))
  })

  it('rejects a trainer trying to export a course', async () => {
    verifySupabaseUser.mockResolvedValue({ id: 'user-1' })
    const course = {
      id: 'course-1', name: 'First aid', organisation_id: 'org-1', status: 'approved',
      is_current_published: true, organisations: { status: 'active' },
    }
    const query = (result) => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: result, error: null }) }
      return chain
    }
    supabaseAdmin.mockReturnValue({
      from: vi.fn((table) => query(table === 'course_catalogue' ? course : null)),
    })
    const res = responseDouble()

    await handler({
      query: {}, method: 'POST', headers: { authorization: 'Bearer token' },
      body: { action: 'exportCourseScorm', courseId: 'course-1' },
    }, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(buildScormCoursePackage).not.toHaveBeenCalled()
  })
})

function responseDouble() {
  const res = {
    setHeader: vi.fn(),
    send: vi.fn(),
    json: vi.fn(),
    status: vi.fn(),
  }
  res.status.mockReturnValue(res)
  return res
}
