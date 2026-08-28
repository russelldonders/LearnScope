// toISOString() reports the UTC calendar date, not the learner's local one --
// for part of every day (the exact part depending on their UTC offset) that's
// a different day than their own "today". Build the date-only string from
// the Date object's local getters instead, so it always matches the
// learner's own calendar day.
function toLocalDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Used as the `min` on every self-assessment scheduling date input, so a
// learner can never schedule a check-in that's already in the past.
export function todayDateString() {
  return toLocalDateString(new Date())
}

export function computeNextSelfAssessmentDate(fromDateStr, value, unit) {
  const from = fromDateStr ? new Date(`${fromDateStr}T00:00:00`) : new Date()
  const next = new Date(from)
  if (unit === 'weeks') next.setDate(next.getDate() + value * 7)
  else if (unit === 'months') next.setMonth(next.getMonth() + value)
  else if (unit === 'years') next.setFullYear(next.getFullYear() + value)
  return toLocalDateString(next)
}

export function isSelfAssessmentDue(nextDate) {
  if (!nextDate) return false
  return nextDate <= todayDateString()
}
