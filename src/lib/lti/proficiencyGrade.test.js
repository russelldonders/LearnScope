import { expect, it } from 'vitest'
import { buildProficiencyScore } from './proficiencyGrade'
const event = { ltiUserId: 'lms-subject-123', timestamp: '2026-09-06T18:00:00.000Z' }
it.each([1, 2, 3, 4, 5])('sends proficiency %s on the native five-point scale', (level) => {
  expect(buildProficiencyScore({ ...event, level })).toEqual({ userId: event.ltiUserId, scoreGiven: level, scoreMaximum: 5, timestamp: event.timestamp, activityProgress: 'Completed', gradingProgress: 'FullyGraded' })
})
it.each([null, undefined])('does not send a grade for unassessed proficiency %s', (level) => {
  expect(buildProficiencyScore({ ...event, level })).toBeNull()
})
it.each([0, 6, -1, 2.5, '3', NaN])('rejects an invalid proficiency %s', (level) => {
  expect(() => buildProficiencyScore({ ...event, level })).toThrow(/Proficiency/)
})
it('requires the original event timestamp and LMS identity', () => {
  expect(() => buildProficiencyScore({ ...event, level: 3, timestamp: '' })).toThrow(/dated/)
  expect(() => buildProficiencyScore({ ...event, level: 3, ltiUserId: '' })).toThrow(/LMS user ID/)
})
it('retains a lower revised level instead of keeping the highest historical grade', () => {
  expect(buildProficiencyScore({ ...event, level: 2 }).scoreGiven).toBe(2)
})
