// Mirrors course_catalogue.duration_unit's check constraint
// (20260907230000_provider_course_form_fields.sql).
export const DURATION_UNITS = [
  { value: 'mins', label: 'Minutes', singular: 'minute', plural: 'minutes' },
  { value: 'hours', label: 'Hours', singular: 'hour', plural: 'hours' },
  { value: 'days', label: 'Days', singular: 'day', plural: 'days' },
  { value: 'weeks', label: 'Weeks', singular: 'week', plural: 'weeks' },
]

const UNIT_BY_VALUE = Object.fromEntries(DURATION_UNITS.map((u) => [u.value, u]))

// The free-text `duration` column stays populated so every existing
// display site (catalogue listings, provider profile, enrol_in_course_cohort)
// keeps working without any changes -- this just composes it from the
// structured value+unit the provider actually picks, e.g. "6 weeks" or
// "45 minutes", instead of asking them to type it.
export function composeDurationText(value, unit) {
  const numeric = Number(value)
  if (!value || Number.isNaN(numeric) || numeric <= 0) return null
  const unitInfo = UNIT_BY_VALUE[unit]
  if (!unitInfo) return null
  return `${numeric} ${numeric === 1 ? unitInfo.singular : unitInfo.plural}`
}
