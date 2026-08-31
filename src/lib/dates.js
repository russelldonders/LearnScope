export function formatMonthYear(dateStr) {
  if (!dateStr) return ''
  const [year, month] = dateStr.split('-')
  return new Date(Number(year), Number(month) - 1).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })
}

export function formatFullDate(dateStr) {
  if (!dateStr) return ''
  return toDate(dateStr).toLocaleDateString()
}

function toDate(dateStr) {
  return dateStr.includes('T') ? new Date(dateStr) : new Date(`${dateStr}T00:00:00`)
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

// Scales a day count up to months (30-day) or years (365-day) once it gets
// too large to read at a glance as "N days", rounding to the nearest unit.
function relativeMagnitude(days) {
  if (days < 30) return { value: days, unit: 'day' }
  const months = Math.round(days / 30)
  if (months < 12) return { value: months, unit: 'month' }
  return { value: Math.round(days / 365), unit: 'year' }
}

// The dashboard's shared "when" label -- accepts either a date-only string
// (a reminder/target due date) or a full timestamp (an event/activity
// record), and reads naturally for both past and future dates so the same
// convention covers "3 days ago" and "in 3 days" alike. Compares calendar
// days rather than raw elapsed time, so a date-only value doesn't drift
// between "Today" and "Yesterday" depending on what time of day it's viewed.
// Beyond 30/365 days it steps up to months/years so the number stays legible
// (e.g. "2 years ago" rather than "730 days ago").
export function formatRelativeDate(dateStr) {
  if (!dateStr) return ''
  const days = Math.round((startOfDay(toDate(dateStr)) - startOfDay(new Date())) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  const { value, unit } = relativeMagnitude(Math.abs(days))
  const label = `${value} ${unit}${value === 1 ? '' : 's'}`
  return days > 0 ? `In ${label}` : `${label} ago`
}

// The exact-date companion to formatRelativeDate, for a title/tooltip so the
// precise date is still one hover away.
export function formatAbsoluteDate(dateStr) {
  if (!dateStr) return ''
  return toDate(dateStr).toLocaleDateString()
}

// A compact range label for short-lived items (e.g. a sub-experience nested
// under a role): a single-day item shows its exact date rather than a
// month that would otherwise look like a whole-month span, and a range
// that starts and ends in the same month isn't repeated on both ends.
export function formatDateRange(startDate, endDate) {
  if (!endDate) return formatMonthYear(startDate)
  if (startDate === endDate) return formatFullDate(startDate)
  const startMonth = formatMonthYear(startDate)
  const endMonth = formatMonthYear(endDate)
  return startMonth === endMonth ? startMonth : `${startMonth} – ${endMonth}`
}
