import { describe, expect, it } from 'vitest'
import { buildNotificationItems } from './notifications'

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
