import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn() }

vi.mock('./supabaseClient', () => ({ supabase: { from, rpc } }))

const { listMySkillDevelopmentTargets } = await import('./skillDevelopmentTargets')

beforeEach(() => {
  from.mockReset().mockReturnValue(query)
  rpc.mockReset()
  query.select.mockReset().mockReturnValue(query)
  query.eq.mockReset().mockReturnValue(query)
  query.order.mockReset()
})

describe('skill development targets', () => {
  it('keeps the latest personal target per skill separate from employer-owned targets', async () => {
    query.order.mockResolvedValueOnce({
      data: [
        { id: 'personal-new', skill_id: 'skill-1', target_level: 4, target_date: '2027-01-01', comments: 'New', created_at: '2026-09-21', skills: { id: 'skill-1', name: 'SQL' } },
        { id: 'personal-old', skill_id: 'skill-1', target_level: 3, target_date: '2026-10-01', comments: 'Old', created_at: '2026-08-01', skills: { id: 'skill-1', name: 'SQL' } },
      ],
      error: null,
    })
    rpc.mockResolvedValueOnce({
      data: [{
        id: 'employer-1', employer_id: 'org-1', employer_name: 'Acme', employer_member_id: 'member-1',
        skill_library_id: 'library-1', skill_name: 'Coaching', target_level: 5, target_date: '2027-02-01',
        notes: 'Lead the team', status: 'active', created_at: '2026-09-21', closed_at: null,
      }],
      error: null,
    })

    const result = await listMySkillDevelopmentTargets('user-1')

    expect(result.personal).toHaveLength(1)
    expect(result.personal[0]).toMatchObject({ id: 'personal-new', ownership: 'personal', skillName: 'SQL' })
    expect(result.employer[0]).toMatchObject({ ownership: 'employer', employerName: 'Acme', skillName: 'Coaching' })
    expect(rpc).toHaveBeenCalledWith('list_my_employer_skill_development_targets')
  })
})
