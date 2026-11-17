import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { auth: { getSession } } }))

import { downloadCourseScormPackage } from './scormExport'

describe('downloadCourseScormPackage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['zip']), {
      status: 200,
      headers: { 'content-disposition': 'attachment; filename="Safety-SCORM-1.2.zip"' },
    })))
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('requests an authorised export and downloads the returned zip', async () => {
    await downloadCourseScormPackage('course-1')

    expect(fetch).toHaveBeenCalledWith('/api/admin/actions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      body: JSON.stringify({ action: 'exportCourseScorm', courseId: 'course-1' }),
    }))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('requires an active LearnScope session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    await expect(downloadCourseScormPackage('course-1')).rejects.toThrow('Sign in again')
  })
})
