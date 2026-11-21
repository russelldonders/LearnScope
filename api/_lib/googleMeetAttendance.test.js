import { describe, expect, it } from 'vitest'
import { participantIdentity, summarizeAttendance } from './googleMeetAttendance.js'

describe('summarizeAttendance', () => {
  it('merges overlapping devices and clamps attendance to the scheduled window', () => {
    const result = summarizeAttendance([
      { joined_at: '2026-11-21T09:50:00Z', left_at: '2026-11-21T10:30:00Z' },
      { joined_at: '2026-11-21T10:20:00Z', left_at: '2026-11-21T10:50:00Z' },
      { joined_at: '2026-11-21T10:55:00Z', left_at: '2026-11-21T11:10:00Z' },
    ], '2026-11-21T10:00:00Z', '2026-11-21T11:00:00Z')

    expect(result).toEqual({
      attendedSeconds: 3300,
      attendancePercent: 91.67,
      firstJoinedAt: '2026-11-21T10:00:00.000Z',
      lastLeftAt: '2026-11-21T11:00:00.000Z',
    })
  })

  it('returns zero for a learner with no matched sessions', () => {
    expect(summarizeAttendance([], '2026-11-21T10:00:00Z', '2026-11-21T11:00:00Z')).toMatchObject({
      attendedSeconds: 0,
      attendancePercent: 0,
      firstJoinedAt: null,
      lastLeftAt: null,
    })
  })
})

describe('participantIdentity', () => {
  it('uses the stable Google account id for a signed-in participant', () => {
    expect(participantIdentity({ signedinUser: { user: 'users/123', displayName: 'Ada' } })).toEqual({
      kind: 'signed_in', googleUserId: '123', displayName: 'Ada',
    })
  })

  it('keeps telephone attendees unresolved', () => {
    expect(participantIdentity({ phoneUser: { displayName: '*** 1234' } })).toEqual({
      kind: 'phone', googleUserId: null, displayName: '*** 1234',
    })
  })
})
