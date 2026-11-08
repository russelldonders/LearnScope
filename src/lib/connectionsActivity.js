// Shaping list_connections_activity (0063/0102) rows for the Connections feed.

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

function sectionFor(eventAt, now) {
  const age = now - new Date(eventAt).getTime()
  if (age < 7 * DAY_MS) return 'thisWeek'
  if (age < 30 * DAY_MS) return 'thisMonth'
  return 'earlier'
}

// Time sections, newest first, each holding one block per person (in order of
// their newest event) so several updates from one person read as one story.
export function sectionedActivity(events, now = Date.now()) {
  const sections = []
  for (const event of events) {
    const key = sectionFor(event.event_at, now)
    let section = sections.find((s) => s.key === key)
    if (!section) {
      section = { key, people: [] }
      sections.push(section)
    }
    let person = section.people.find((p) => p.actorId === event.actor_id)
    if (!person) {
      person = { actorId: event.actor_id, name: event.full_name, avatarUrl: event.avatar_url, events: [] }
      section.people.push(person)
    }
    person.events.push(event)
  }
  return sections
}
