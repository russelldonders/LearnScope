import { LEVELS } from '../levels.js'

// Payload preparation only. A future server must obtain ltiUserId from a
// verified launch, the level from the authorised current skill record, and
// the timestamp from its persisted change event. This does not send a grade.
export function buildProficiencyScore({ ltiUserId, level, timestamp }) {
  if (typeof ltiUserId !== 'string' || !ltiUserId.trim()) throw new Error('A verified LMS user ID is required')
  // An unknown level is not zero and must not accidentally clear an LMS grade.
  if (level == null) return null
  if (!LEVELS.includes(level)) throw new Error('Proficiency must be an integer from 1 to 5')
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error('A dated proficiency event is required')
  }
  return {
    userId: ltiUserId,
    scoreGiven: level,
    scoreMaximum: 5,
    timestamp,
    // This evaluation is complete; future proficiency changes can update it.
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
  }
}
