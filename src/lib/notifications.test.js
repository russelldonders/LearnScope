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

describe('coaching session notifications', () => {
  const NOW = new Date('2026-11-24T12:00:00Z').getTime()
  const learnerSide = { id: 'r1', role: 'learner', status: 'active', other_name: 'Coral', learner_skill_id: 'mine', coach_skill_id: 'theirs' }
  const coachSide = { ...learnerSide, role: 'coach', other_name: 'Lee' }
  const session = (fields) => ({ id: 's1', relationship_id: 'r1', starts_at: '2026-11-30T10:00:00Z', created_at: '2026-11-23T10:00:00Z', ...fields })

  it('asks for an answer to a time the other person proposed, on the skill page of whoever reads it', () => {
    const [item] = coachingNotifications([coachSide], [], NOW, [session({ status: 'proposed', proposed_by_me: false })])
    expect(item).toMatchObject({ kind: 'coaching-session-proposed', actions: [{ href: '/skills/theirs?tab=network' }] })
    expect(item.detail).toMatch(/^Lee proposed a coaching session on /)
    expect(coachingNotifications([coachSide], [], NOW, [session({ status: 'proposed', proposed_by_me: true })])).toEqual([])
  })

  it('reminds the learner to mark a session that has happened as done', () => {
    const [item] = coachingNotifications([learnerSide], [], NOW, [session({ status: 'confirmed', starts_at: '2026-11-24T09:00:00Z' })])
    expect(item).toMatchObject({ kind: 'coaching-session-done', actions: [{ label: 'Mark as done', href: '/skills/mine?tab=network' }] })
    expect(coachingNotifications([coachSide], [], NOW, [session({ status: 'confirmed', starts_at: '2026-11-24T09:00:00Z' })])).toEqual([])
  })

  it('says when the other person confirmed or cancelled', () => {
    const confirmed = coachingNotifications([learnerSide], [], NOW, [session({ status: 'confirmed', proposed_by_me: true, responded_at: '2026-11-24T08:00:00Z' })])
    expect(confirmed[0].kind).toBe('coaching-session-confirmed')
    const cancelled = coachingNotifications([learnerSide], [], NOW, [session({ status: 'cancelled', cancelled_by_me: false, cancelled_at: '2026-11-24T08:00:00Z' })])
    expect(cancelled[0].kind).toBe('coaching-session-cancelled')
    expect(coachingNotifications([learnerSide], [], NOW, [session({ status: 'cancelled', cancelled_by_me: true, cancelled_at: '2026-11-24T08:00:00Z' })])).toEqual([])
  })
})

describe('coach review notifications', () => {
  it('tells the coach about a recent review, opening the skill they coach from', () => {
    const NOW = new Date('2026-11-24T12:00:00Z').getTime()
    const review = { id: 'v1', rating: 4, reviewer_name: 'Rae', skill_name: 'Mentoring', coach_skill_id: 'theirs', updated_at: '2026-11-23T10:00:00Z' }
    const [item] = coachingNotifications([], [], NOW, [], [review])
    expect(item).toMatchObject({
      id: 'coach-review:v1',
      detail: 'Rae reviewed your coaching in Mentoring: 4 out of 5 stars.',
      actions: [{ href: '/skills/theirs?tab=network' }],
    })
    expect(coachingNotifications([], [], NOW, [], [{ ...review, updated_at: '2026-09-01T10:00:00Z' }])).toEqual([])
  })
})
