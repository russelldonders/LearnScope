function asMillis(value) {
  const millis = new Date(value).getTime()
  return Number.isFinite(millis) ? millis : null
}

// Google creates a participant session for every join/device pair. Merge
// overlapping intervals before calculating attendance so joining on a phone
// and laptop at the same time never counts twice.
export function summarizeAttendance(segments, scheduledStart, scheduledEnd, now = new Date()) {
  const windowStart = asMillis(scheduledStart)
  const windowEnd = asMillis(scheduledEnd)
  if (windowStart === null || windowEnd === null || windowEnd <= windowStart) {
    throw new Error('A valid scheduled start and end time are required.')
  }

  const nowMillis = asMillis(now)
  const intervals = (segments ?? [])
    .map((segment) => {
      const joined = asMillis(segment.joined_at ?? segment.startTime)
      const left = asMillis(segment.left_at ?? segment.endTime) ?? nowMillis
      if (joined === null || left === null) return null
      const start = Math.max(windowStart, joined)
      const end = Math.min(windowEnd, left)
      return end > start ? [start, end] : null
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0])

  const merged = []
  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    if (!previous || interval[0] > previous[1]) merged.push([...interval])
    else previous[1] = Math.max(previous[1], interval[1])
  }

  const attendedSeconds = Math.round(merged.reduce((sum, [start, end]) => sum + (end - start), 0) / 1000)
  const scheduledSeconds = Math.round((windowEnd - windowStart) / 1000)
  const attendancePercent = Math.min(100, Math.round((attendedSeconds / scheduledSeconds) * 10000) / 100)

  return {
    attendedSeconds,
    attendancePercent,
    firstJoinedAt: merged.length ? new Date(merged[0][0]).toISOString() : null,
    lastLeftAt: merged.length ? new Date(merged[merged.length - 1][1]).toISOString() : null,
  }
}

export function participantIdentity(participant) {
  if (participant?.signedinUser?.user) {
    return {
      kind: 'signed_in',
      googleUserId: participant.signedinUser.user.replace(/^users\//, ''),
      displayName: participant.signedinUser.displayName || 'Signed-in attendee',
    }
  }
  if (participant?.phoneUser) {
    return {
      kind: 'phone',
      googleUserId: null,
      displayName: participant.phoneUser.displayName || 'Telephone attendee',
    }
  }
  return {
    kind: 'anonymous',
    googleUserId: null,
    displayName: participant?.anonymousUser?.displayName || 'Anonymous attendee',
  }
}
