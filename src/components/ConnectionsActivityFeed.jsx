import PersonAvatar from './PersonAvatar'
import { LEVEL_LABELS } from '../lib/levels'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'

// Turns one list_connections_activity (0063/0102) row into a plain-language
// sentence -- everything needed to say it is already in the row itself
// (skill_name/level/detail), never a client-side lookup, since each row is
// independently privacy-checked server-side and shouldn't need extra trust.
export function describeActivityEvent(event) {
  const level = event.level ? LEVEL_LABELS[event.level] : null
  switch (event.event_type) {
    case 'skill_confirmed':
      return `confirmed ${level ?? 'a level'} in ${event.skill_name}`
    case 'skill_validated':
      return `had ${event.skill_name} validated at ${level ?? 'their target level'}`
    case 'skill_added':
      return `started tracking ${event.skill_name}`
    case 'experience_added':
      return `added ${event.detail}`
    case 'course_started':
      return `started ${event.detail}`
    case 'target_set':
      return `set a target of ${level ?? 'a new level'} for ${event.skill_name}`
    default:
      return null
  }
}

// Shared by Dashboard.jsx ("What your connections are up to", aggregated
// across every connection) and SkillsProfile.jsx (scoped to just the one
// person being viewed) -- same event shape either way, so one rendering.
export default function ConnectionsActivityFeed({ events }) {
  return (
    <div className="space-y-2">
      {events.map((event, i) => {
        const description = describeActivityEvent(event)
        if (!description) return null
        return (
          <div
            key={`${event.event_type}-${event.actor_id}-${event.event_at}-${i}`}
            className="flex items-start gap-3 bg-card border border-hairline rounded-lg px-4 py-3"
          >
            <PersonAvatar name={event.full_name} avatarUrl={event.avatar_url} size={9} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <span className="font-medium">{event.full_name || 'A connection'}</span> {description}
              </p>
              {event.event_type === 'skill_confirmed' && event.detail && (
                <p className="text-xs text-secondary mt-0.5">{event.detail}</p>
              )}
            </div>
            <p className="font-mono text-xs text-secondary shrink-0" title={formatAbsoluteDate(event.event_at)}>
              {formatRelativeDate(event.event_at)}
            </p>
          </div>
        )
      })}
    </div>
  )
}
