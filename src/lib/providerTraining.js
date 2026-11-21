import { COURSE_STATUS_LABELS } from './statusLabels'

// Sort accessors, labels and messages for the provider console's catalogue
// and training tables (ProviderCataloguesSection, ProviderTrainingSection).

export const COURSE_SORT_ACCESSORS = {
  course_code: (c) => c.course_code?.toLowerCase() ?? '',
  name: (c) => c.name?.toLowerCase() ?? '',
  version: (c) => c.version_number ?? 0,
  status: (c) => COURSE_STATUS_LABELS[c.status] ?? c.status,
  rejection_reason: (c) => c.rejection_reason?.toLowerCase() ?? '',
  synopsis: (c) => c.synopsis?.toLowerCase() ?? '',
}

export const CATALOGUE_SORT_ACCESSORS = {
  id: (c) => c.id ?? '',
  name: (c) => c.name?.toLowerCase() ?? '',
  description: (c) => c.description?.toLowerCase() ?? '',
}

export function buildBulkCatalogueDeleteMessage(targets) {
  const label = targets.length === 1 ? 'catalogue' : 'catalogues'
  const withCourses = targets.filter((c) => (c.courseCount ?? 0) > 0)
  if (withCourses.length === 0) {
    return `Delete ${targets.length} ${label}? Courses currently published there will no longer appear in it.`
  }
  const totalCourses = withCourses.reduce((sum, c) => sum + (c.courseCount ?? 0), 0)
  return (
    `Delete ${targets.length} ${label}? ${withCourses.length} of ${
      targets.length === 1 ? 'it currently has' : 'them currently have'
    } courses published there (${totalCourses} course${totalCourses === 1 ? '' : 's'} total) — ${
      totalCourses === 1 ? 'it' : 'they'
    } will disappear from that catalogue, and may become invisible to learners entirely if this was its only destination.`
  )
}

export const PARTICIPANT_STATUS_LABELS = { enrolled: 'Enrolled', started: 'Started', complete: 'Complete', cancelled: 'Cancelled' }

export function formatParticipantDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}
