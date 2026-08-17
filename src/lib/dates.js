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
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString()
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
