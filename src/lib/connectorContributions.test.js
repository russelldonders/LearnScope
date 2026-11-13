import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const { groupContributionsBySkill } = await import('./connectorContributions')

function statement(id, name, recordedAt, { skillId = null, duration = null } = {}) {
  return {
    id,
    recorded_at: recordedAt,
    skill_id: skillId,
    statement: {
      object: { definition: { name: { 'en-US': name } } },
      ...(duration ? { result: { duration } } : {}),
    },
  }
}

describe('groupContributionsBySkill', () => {
  const skills = [
    { id: 'run', name: 'Running' },
    { id: 'ride', name: 'Cycling' },
    { id: 'fit', name: 'Fitness' },
  ]

  it('groups activities by skill, most active skill first and newest activity first', () => {
    const groups = groupContributionsBySkill(
      [
        statement('a', 'Morning run', '2026-10-01T07:00:00Z', { skillId: 'run', duration: 'PT30M' }),
        statement('b', 'Evening run', '2026-10-03T18:00:00Z', { skillId: 'run', duration: 'PT1H' }),
        statement('c', 'Commute', '2026-10-02T08:00:00Z', { skillId: 'ride' }),
      ],
      [],
      skills,
    )
    expect(groups.map((g) => g.skillName)).toEqual(['Running', 'Cycling'])
    expect(groups[0].activities.map((a) => a.name)).toEqual(['Evening run', 'Morning run'])
    expect(groups[0].totalMinutes).toBe(90)
    expect(groups[1].totalMinutes).toBe(0)
  })

  it('lists an activity under every skill it is linked to, without duplicating within a skill', () => {
    const groups = groupContributionsBySkill(
      [statement('a', 'Brick session', '2026-10-01T07:00:00Z', { skillId: 'run' })],
      [
        { statement_id: 'a', skill_id: 'run' },
        { statement_id: 'a', skill_id: 'fit' },
      ],
      skills,
    )
    expect(groups.map((g) => [g.skillName, g.activities.length])).toEqual([
      ['Fitness', 1],
      ['Running', 1],
    ])
  })

  it('leaves out activities whose skill no longer exists, and returns nothing for no activities', () => {
    expect(groupContributionsBySkill([statement('a', 'Old', '2026-01-01', { skillId: 'gone' })], [], skills)).toEqual([])
    expect(groupContributionsBySkill([], [], skills)).toEqual([])
  })
})
