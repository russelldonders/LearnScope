// Shaping list_connections_activity (0063/0102) rows for the People page.

const DAY_MS = 24 * 60 * 60 * 1000

// The same milestone across several skills (e.g. ten skills added at once)
// becomes one event listing them all, newest skill first.
export function groupConnectionsActivity(events) {
  const groups = []
  const groupByKey = new Map()

  for (const event of events) {
    if (!event.skill_name) {
      groups.push({ ...event, skills: [] })
      continue
    }

    const key = JSON.stringify([event.actor_id, event.event_type, event.level ?? null, event.detail ?? null])
    const existing = groupByKey.get(key)
    if (existing && !existing.skills.includes(event.skill_name)) {
      existing.skills.push(event.skill_name)
      continue
    }

    const group = { ...event, skills: [event.skill_name] }
    groups.push(group)
    if (!existing) groupByKey.set(key, group)
  }

  return groups
}

// "employment at Continental: Tire kicking" -> organisation and title.
export function parseExperience(detail) {
  const match = /^[^ ]+ at (.+?): (.+)$/.exec(detail ?? '')
  return match ? { organisation: match[1], title: match[2] } : { organisation: null, title: detail }
}

// "Course name · Provider".
export function parseCourse(detail) {
  const [name, ...provider] = (detail ?? '').split(' · ')
  return { name, provider: provider.join(' · ') || null }
}

export const RECENT_DAYS = 30

export function isRecent(eventAt, now = Date.now()) {
  return now - new Date(eventAt).getTime() < RECENT_DAYS * DAY_MS
}

// What a person's been doing, most telling first: a validated or confirmed
// level, then finished courses and new roles, then what they've started,
// aimed for, added or planned. A cancelled course isn't news worth leading
// with, so it stays in the details only.
const SUMMARY_ORDER = [
  'skill_validated',
  'skill_confirmed',
  'course_completed',
  'experience_added',
  'course_started',
  'target_set',
  'skill_added',
  'course_planned',
]

// The thing each event is about, so the same skill or course counts once.
function subjectOf(event) {
  if (event.event_type.startsWith('course_')) return parseCourse(event.detail).name
  if (event.event_type === 'experience_added') return event.detail
  return event.skill_name
}

function summaryPart(type, events) {
  const first = events[0]
  const count = events.length
  const one = count === 1
  switch (type) {
    case 'skill_validated':
      return one
        ? { key: 'validatedOne', params: { skill: first.skill_name, level: first.level } }
        : { key: 'validatedMany', params: { count } }
    case 'skill_confirmed':
      return one
        ? { key: 'reachedOne', params: { skill: first.skill_name, level: first.level } }
        : { key: 'reachedMany', params: { count } }
    case 'course_completed':
      return one ? { key: 'completedOne', params: { name: parseCourse(first.detail).name } } : { key: 'completedMany', params: { count } }
    case 'experience_added': {
      if (!one) return { key: 'rolesMany', params: { count } }
      const { organisation, title } = parseExperience(first.detail)
      return organisation
        ? { key: 'roleAt', params: { title, organisation } }
        : { key: 'roleOne', params: { title } }
    }
    case 'course_started':
      return one ? { key: 'startedOne', params: { name: parseCourse(first.detail).name } } : { key: 'startedMany', params: { count } }
    case 'target_set':
      return one && first.level
        ? { key: 'aimingOne', params: { skill: first.skill_name, level: first.level } }
        : { key: 'targetsMany', params: { count } }
    case 'skill_added':
      return one ? { key: 'addedOne', params: { skill: first.skill_name } } : { key: 'addedMany', params: { count } }
    case 'course_planned':
      return one ? { key: 'plannedOne', params: { name: parseCourse(first.detail).name } } : { key: 'plannedMany', params: { count } }
    default:
      return null
  }
}

// One person's recent events (newest first) as a short list of phrases --
// { key, params } for connectionsActivity.summary.* -- most telling first,
// each kind of thing once. Levels arrive as numbers for the caller to label.
export function summariseActivity(events, max = 3) {
  const byType = new Map()
  for (const event of events) {
    if (!SUMMARY_ORDER.includes(event.event_type)) continue
    const subject = subjectOf(event)
    const list = byType.get(event.event_type) ?? []
    // Newest first, so the first time a subject appears is its latest news.
    if (!list.some((e) => subjectOf(e) === subject)) list.push(event)
    byType.set(event.event_type, list)
  }
  const parts = SUMMARY_ORDER
    .filter((type) => byType.has(type))
    .map((type) => summaryPart(type, byType.get(type)))
    .filter(Boolean)
  return { parts: parts.slice(0, max), more: Math.max(0, parts.length - max) }
}
