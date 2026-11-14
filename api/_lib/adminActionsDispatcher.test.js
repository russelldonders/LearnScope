import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generateCourseDraftHandler } = vi.hoisted(() => ({
  generateCourseDraftHandler: vi.fn(),
}))

vi.mock('./generateCourseDraftHandler.js', () => ({
  default: generateCourseDraftHandler,
}))

import handler from '../admin/actions.js'

describe('admin action dispatcher', () => {
  beforeEach(() => generateCourseDraftHandler.mockReset())

  it('dispatches the course-generation route before admin authentication', async () => {
    const req = { query: { ai: 'generate-course-draft' }, method: 'POST', headers: {} }
    const res = {}

    await handler(req, res)

    expect(generateCourseDraftHandler).toHaveBeenCalledOnce()
    expect(generateCourseDraftHandler).toHaveBeenCalledWith(req, res)
  })
})
