import { describe, expect, it } from 'vitest'
import { buildNotificationItems, coachingNotifications } from './notifications'

const emptyValues = {
  planInvites: [],
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
  selfAssessments: [],
  targets: [],
  goals: [],
}

describe('buildNotificationItems', () => {
  it('includes dashboard attention reminders with direct actions and stable dismissal ids', () => {
    const [notification] = buildNotificationItems({
      ...emptyValues,
      selfAssessments: [{ id: 'skill-1', name: 'Facilitation', next_checkin_date: '2026-11-17' }],
    })

    expect(notification).toMatchObject({
      id: 'self-assessment-reminder:skill-1:2026-11-17',
      title: 'Self-assessment due',
      actions: [{ label: 'Self-assess now', href: '/skills/skill-1?action=self-assess' }],
    })
  })

  it('gives every actionable source a control in the notification row', () => {
    const items = buildNotificationItems({
      ...emptyValues,
      rateInvites: [{ id: 'invite-1', share_code: 'abc', skill_name: 'Coaching', created_at: '2026-11-17T10:00:00Z' }],
      courseAssignments: [{ id: 'course-1', course_catalogue: { name: 'Safety' }, created_at: '2026-11-17T09:00:00Z' }],
    })

    expect(items.every((item) => item.actions.length > 0)).toBe(true)
    expect(items.find((item) => item.kind === 'rate-invite').actions[0].href).toBe('/rate/abc')
  })

  it('lists a plan an organisation assigned, linking to where it can be started', () => {
    const [item] = buildNotificationItems({
      ...emptyValues,
      planAssignments: [{ id: 'assignment-1', title: 'New manager plan', organisation_name: 'Acme', assigned_at: '2026-11-21T09:00:00Z' }],
    })
    expect(item).toMatchObject({
      id: 'plan-assignment:assignment-1',
      title: 'Plan Assigned',
      detail: 'New manager plan',
      source: 'Acme',
      actions: [{ label: 'Review plan', href: '/actions#assigned-plans' }],
    })
  })
})

describe('coachingNotifications', () => {
  const NOW = new Date('2026-11-24T12:00:00Z').getTime()
  const row = (fields) => ({
    id: 'r1', other_name: 'Coral', skill_name: 'Public speaking', learner_skill_id: 'mine', coach_skill_id: 'theirs',
    requested_at: '2026-11-20T10:00:00Z', responded_at: null, ...fields,
  })

  it('tells a coach about a request, opening the skill they coach from', () => {
    const [item] = coachingNotifications([row({ role: 'coach', status: 'requested', other_name: 'Lee' })], [], NOW)
    expect(item).toMatchObject({
      id: 'coaching-request:r1',
      detail: 'Lee asked you to coach them in Public speaking.',
      actions: [{ href: '/skills/theirs?tab=network' }],
    })
  })

  it('tells a learner the answer while it is recent, and not after', () => {
    const accepted = coachingNotifications([row({ role: 'learner', status: 'active', responded_at: '2026-11-23T10:00:00Z' })], [], NOW)
    expect(accepted[0]).toMatchObject({ kind: 'coaching-accepted', detail: 'Coral agreed to coach you in Public speaking.', actions: [{ href: '/skills/mine?tab=network' }] })
    const declined = coachingNotifications([row({ role: 'learner', status: 'declined', responded_at: '2026-11-23T10:00:00Z' })], [], NOW)
    expect(declined[0].kind).toBe('coaching-declined')
    expect(coachingNotifications([row({ role: 'learner', status: 'active', responded_at: '2026-09-01T10:00:00Z' })], [], NOW)).toEqual([])
    // Nothing about requests still waiting or coaching they ended.
    expect(coachingNotifications([row({ role: 'learner', status: 'requested' }), row({ role: 'coach', status: 'ended' })], [], NOW)).toEqual([])
  })

  it('tells a learner looking for a coach when one becomes available', () => {
    const interests = [
      { id: 'i1', skill_id: 'mine', skill_name: 'Public speaking', coach_available_at: '2026-11-22T09:00:00Z' },
      { id: 'i2', skill_id: 'other', skill_name: 'Negotiation', coach_available_at: null },
    ]
    const items = coachingNotifications([], interests, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'coach-available:i1', actions: [{ label: 'Find a coach', href: '/skills/mine?tab=network' }] })
  })
})
