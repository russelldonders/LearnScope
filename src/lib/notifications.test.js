import { describe, expect, it, vi } from 'vitest'
import { buildNotificationItems } from './notifications'

vi.mock('./supabaseClient', () => ({ supabase: {} }))

const emptyValues = {
  rateInvites: [],
  recommendInvites: [],
  unseenRatings: [],
  connectionRequests: [],
  validationRequests: [],
  orgInvites: [],
  employerInvites: [],
  dataAccessRequests: [],
  courseAssignments: [],
  skillSuggestions: [],
  managerTeamInvites: [],
  managerTeamSkillSuggestions: [],
}

describe('buildNotificationItems', () => {
  it('combines account-wide sources, labels their origin, and sorts newest first', () => {
    const values = {
      ...emptyValues,
      connectionRequests: [{ id: 'connection-1', requester_id: 'person-1', created_at: '2026-09-27T10:00:00Z' }],
      courseAssignments: [{
        id: 'course-1',
        created_at: '2026-09-29T10:00:00Z',
        employers: { name: 'Acme' },
        course_catalogue: { name: 'Safe Handling' },
      }],
      managerTeamInvites: [{
        id: 'team-1',
        managerName: 'Morgan',
        teamName: 'Product Team',
        invitedAt: '2026-09-28T10:00:00Z',
      }],
    }

    const items = buildNotificationItems(values, { 'person-1': { name: 'Taylor' } })

    expect(items.map((item) => item.title)).toEqual(['Course Assigned', 'Team Invitation', 'Connection Request'])
    expect(items.map((item) => item.source)).toEqual(['Acme', 'Product Team', 'Personal'])
    expect(items[2].detail).toContain('Taylor')
  })

  it('uses resilient labels when joined records or profile names are unavailable', () => {
    const values = {
      ...emptyValues,
      employerInvites: [{ id: 'invite-1', role: 'member', created_at: null, employers: null }],
      skillSuggestions: [{ id: 'skill-1', skill_name: '', created_at: null, employers: null }],
    }

    expect(buildNotificationItems(values)).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Workspace Invitation', source: 'Employer' }),
      expect.objectContaining({ title: 'Skill Suggestion', source: 'Employer' }),
    ]))
  })
})
