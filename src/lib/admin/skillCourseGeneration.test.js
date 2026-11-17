import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    rpc: mocks.rpc,
  },
}))

import { buildSkillCourseBrief, generateSkillCourseDraft, saveGeneratedSkillCourseJob } from './skillCourseGeneration'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildSkillCourseBrief', () => {
  it('anchors the course in the selected knowledge-matrix level', () => {
    const brief = buildSkillCourseBrief({
      name: 'Coaching',
      category: 'Leadership',
      description: 'Helping people think and grow.',
      knowledge_level_guide: [
        'You recognise what coaching is.',
        'You understand the basic coaching cycle.',
        'You understand core models and questioning choices.',
        'You can compare established coaching approaches.',
        'You understand the evidence base and limitations in depth.',
      ],
    }, 3, {
      durationValue: 60,
      durationUnit: 'mins',
      sectionCount: 3,
      pagesPerSection: 2,
      tone: 'Practical and encouraging',
      elements: ['knowledge_check'],
      elementAmount: 'balanced',
      assessmentEnabled: true,
      assessmentQuestionCount: 8,
      assessmentPassMark: 75,
      assessmentPointsPerQuestion: 2,
      assessmentQuestionTypes: ['single', 'ordering'],
    })

    expect(brief.topic).toBe('Coaching — Familiar')
    expect(brief.audience).toContain('Knowledge Level 2')
    expect(brief.outcomes).toContain('core models and questioning choices')
    expect(brief.sourceMaterial).toContain('Target knowledge level: 3 — Familiar')
    expect(brief.sourceMaterial).toContain('Do not imply that completing it proves practical competence')
    expect(brief).toMatchObject({ assessmentEnabled: true, assessmentQuestionCount: '8', assessmentPassMark: '75', assessmentPointsPerQuestion: '2', assessmentQuestionTypes: ['single', 'ordering'] })
  })
})

describe('generateSkillCourseDraft', () => {
  it('starts a background job and polls until its draft is ready', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } })
    const draft = { name: 'Coaching — Aware', sections: [] }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'running' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'completed', draft }) })

    await expect(generateSkillCourseDraft({ topic: 'Coaching' }, 'org-1', {
      skillId: 'skill-1',
      level: 2,
      pollInterval: 0,
    })).resolves.toEqual({ jobId: 'job-1', draft })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][1].body).toContain('"skillId":"skill-1"')
  })

  it('aborts a job when the batch is cancelled after it starts', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobId: 'job-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [{ id: 'job-1', status: 'cancelled' }] }) })

    await expect(generateSkillCourseDraft({ topic: 'Coaching' }, 'org-1', {
      skillId: 'skill-1',
      level: 2,
      pollInterval: 0,
      shouldAbort: () => true,
    })).rejects.toMatchObject({ code: 'COURSE_BUILD_ABORTED' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('saveGeneratedSkillCourseJob', () => {
  it('saves the course from the finished job', async () => {
    mocks.rpc.mockResolvedValue({ data: 'course-1', error: null })
    await expect(saveGeneratedSkillCourseJob({ jobId: 'job-1', publishGlobal: false })).resolves.toBe('course-1')
    expect(mocks.rpc).toHaveBeenCalledWith('save_generated_skill_course_job', { p_job_id: 'job-1', p_publish_global: false })
  })

  it('reports a job aborted before it was saved as an aborted build', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Course build was aborted' } })
    await expect(saveGeneratedSkillCourseJob({ jobId: 'job-1', publishGlobal: true })).rejects.toMatchObject({ code: 'COURSE_BUILD_ABORTED' })
  })
})
