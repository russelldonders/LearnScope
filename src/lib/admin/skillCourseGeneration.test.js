import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
  },
}))

import { buildSkillCourseBrief, generateSkillCourseDraft } from './skillCourseGeneration'

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
    })

    expect(brief.topic).toBe('Coaching — Familiar')
    expect(brief.audience).toContain('Knowledge Level 2')
    expect(brief.outcomes).toContain('core models and questioning choices')
    expect(brief.sourceMaterial).toContain('Target knowledge level: 3 — Familiar')
    expect(brief.sourceMaterial).toContain('Do not imply that completing it proves practical competence')
  })
})

describe('generateSkillCourseDraft', () => {
  it('reads the final draft from a keep-alive JSON-line response', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } })
    const draft = { name: 'Coaching — Aware', sections: [] }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/x-ndjson; charset=utf-8' },
      text: async () => [
        JSON.stringify({ type: 'started' }),
        JSON.stringify({ type: 'keepalive' }),
        JSON.stringify({ type: 'result', status: 200, draft }),
        '',
      ].join('\n'),
    })

    await expect(generateSkillCourseDraft({ topic: 'Coaching' }, 'org-1')).resolves.toEqual(draft)
  })

  it('surfaces an error returned at the end of a keep-alive stream', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/x-ndjson; charset=utf-8' },
      text: async () => [
        JSON.stringify({ type: 'started' }),
        JSON.stringify({ type: 'error', status: 429, error: 'Usage limit reached.' }),
        '',
      ].join('\n'),
    })

    await expect(generateSkillCourseDraft({ topic: 'Coaching' }, 'org-1')).rejects.toThrow('Usage limit reached.')
  })
})
