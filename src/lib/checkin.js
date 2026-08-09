export function computeNextSelfAssessmentDate(fromDateStr, value, unit) {
  const from = fromDateStr ? new Date(`${fromDateStr}T00:00:00`) : new Date()
  const next = new Date(from)
  if (unit === 'weeks') next.setDate(next.getDate() + value * 7)
  else if (unit === 'months') next.setMonth(next.getMonth() + value)
  else if (unit === 'years') next.setFullYear(next.getFullYear() + value)
  return next.toISOString().slice(0, 10)
}

export function isSelfAssessmentDue(nextDate) {
  if (!nextDate) return false
  const today = new Date().toISOString().slice(0, 10)
  return nextDate <= today
}
