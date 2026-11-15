import { describe, expect, it } from 'vitest'
import { buildSkillCourseBrief } from './skillCourseGeneration'

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
