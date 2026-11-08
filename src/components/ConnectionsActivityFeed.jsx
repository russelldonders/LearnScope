import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PersonAvatar from './PersonAvatar'
import GrowthRing from './GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'
import { gradientPairFor } from '../lib/placeholderGradient'
import { useLanguage } from '../context/LanguageContext'
import { groupConnectionsActivity, sectionedActivity } from '../lib/connectionsActivity'

const INITIAL_VISIBLE = 8
const SHOWN_SKILLS = 3

// Turns one list_connections_activity (0063/0102) row into a plain-language
// sentence -- everything needed to say it is already in the row itself
// (skill_name/level/detail), never a client-side lookup, since each row is
// independently privacy-checked server-side and shouldn't need extra trust.
// Level labels stay English, as everywhere else they're shown. Read out to
// screen readers in place of the visual layout below.
export function describeActivityEvent(event, t) {
  const level = event.level ? LEVEL_LABELS[event.level] : null
  const additionalSkills = (event.skills?.length ?? 1) - 1
  const skill = additionalSkills > 0
    ? t(additionalSkills === 1 ? 'connectionsActivity.skillAndOneOther' : 'connectionsActivity.skillAndOthers',
      { skill: event.skill_name, count: additionalSkills })
    : event.skill_name
  switch (event.event_type) {
    case 'skill_confirmed':
      return t('connectionsActivity.confirmed', { level: level ?? t('connectionsActivity.aLevel'), skill })
    case 'skill_validated':
      return t('connectionsActivity.validated', { level: level ?? t('connectionsActivity.theirTargetLevel'), skill })
    case 'skill_added':
      return t('connectionsActivity.skillAdded', { skill })
    case 'experience_added':
      return t('connectionsActivity.experienceAdded', { detail: event.detail })
    case 'course_started':
      return t('connectionsActivity.courseStarted', { detail: event.detail })
    case 'target_set':
      return t('connectionsActivity.targetSet', { level: level ?? t('connectionsActivity.aNewLevel'), skill })
    default:
      return null
  }
}

// list_connections_activity's detail strings (0102), written in English by the
// database. Validated by someone breaks to slate and a knowledge check counts
// as confirmed, matching the trust colours used elsewhere; an AI estimate
// stays muted so it never looks like more than it is.
const EVIDENCE = {
  'Validated by a connection': { key: 'validated', className: 'border-slate text-slate bg-slate/10' },
  'Confirmed via knowledge check': { key: 'knowledgeCheck', className: 'border-moss text-moss bg-moss/10' },
  'AI-assessed baseline': { key: 'ai', className: 'border-hairline text-secondary' },
  'AI assessment': { key: 'ai', className: 'border-hairline text-secondary' },
}

// "employment at Continental: Tire kicking" -> organisation and title.
function parseExperience(detail) {
  const match = /^[^ ]+ at (.+?): (.+)$/.exec(detail ?? '')
  return match ? { organisation: match[1], title: match[2] } : { organisation: null, title: detail }
}

// "Course name · Provider".
function parseCourse(detail) {
  const [name, ...provider] = (detail ?? '').split(' · ')
  return { name, provider: provider.join(' · ') || null }
}

function IconTile({ children }) {
  return (
    <span className="w-9 h-9 rounded-full border border-hairline bg-paper text-moss flex items-center justify-center">
      {children}
    </span>
  )
}

function EventVisual({ event }) {
  switch (event.event_type) {
    case 'skill_confirmed':
    case 'skill_validated':
      return <GrowthRing level={event.level} size={36} color={event.event_type === 'skill_validated' ? 'var(--color-slate)' : undefined} />
    case 'target_set':
      return <GrowthRing level={0} targetLevel={event.level} size={36} />
    case 'course_started': {
      const { name, provider } = parseCourse(event.detail)
      const [from, to] = gradientPairFor(`${name ?? ''}|${provider ?? ''}`)
      return (
        <span
          className="w-9 h-9 rounded-md flex items-center justify-center font-display text-sm text-paper/90"
          style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        >
          {name?.trim()?.[0]?.toUpperCase() ?? '?'}
        </span>
      )
    }
    case 'experience_added':
      return (
        <IconTile>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
          </svg>
        </IconTile>
      )
    default:
      return (
        <IconTile>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2-5-6-5 0 3 2 5 6 5z" />
          </svg>
        </IconTile>
      )
  }
}

function SkillNames({ skills }) {
  const { t } = useLanguage()
  const shown = skills.slice(0, SHOWN_SKILLS)
  const more = skills.length - shown.length
  return (
    <>
      <span className="font-medium">{shown.join(', ')}</span>
      {more > 0 && <span className="text-secondary"> {t('connectionsActivity.moreSkills', { count: more })}</span>}
    </>
  )
}

function Pill({ className, children }) {
  return <span className={`inline-block rounded-full border px-2 py-px text-[11px] leading-4 align-middle ${className}`}>{children}</span>
}

// The achievement leads (the skill, course or role, with its level), and what
// happened plus how it's backed up sits underneath.
function EventLines({ event }) {
  const { t } = useLanguage()
  const level = event.level ? LEVEL_LABELS[event.level] : null
  const evidence = EVIDENCE[event.detail]

  if (event.event_type === 'course_started') {
    const { name, provider } = parseCourse(event.detail)
    return (
      <>
        <p className="text-sm text-ink font-medium break-words">{name}</p>
        <p className="text-xs text-secondary">
          {t('connectionsActivity.action.courseStarted')}{provider ? ` · ${provider}` : ''}
        </p>
      </>
    )
  }
  if (event.event_type === 'experience_added') {
    const { organisation, title } = parseExperience(event.detail)
    return (
      <>
        <p className="text-sm text-ink font-medium break-words">{title}</p>
        <p className="text-xs text-secondary">
          {t('connectionsActivity.action.experienceAdded')}{organisation ? ` · ${organisation}` : ''}
        </p>
      </>
    )
  }

  const action = {
    skill_confirmed: t('connectionsActivity.action.confirmed'),
    skill_validated: t('connectionsActivity.action.validated'),
    skill_added: t('connectionsActivity.action.skillAdded'),
    target_set: level ? t('connectionsActivity.action.targetSet', { level }) : t('connectionsActivity.action.targetSetNoLevel'),
  }[event.event_type]
  const showLevelPill = level && (event.event_type === 'skill_confirmed' || event.event_type === 'skill_validated')

  return (
    <>
      <p className="text-sm text-ink break-words">
        <SkillNames skills={event.skills.length > 0 ? event.skills : [event.skill_name]} />
        {showLevelPill && (
          <> <Pill className={event.event_type === 'skill_validated' ? 'border-slate text-slate' : 'border-gold text-gold'}>{level}</Pill></>
        )}
      </p>
      <p className="text-xs text-secondary flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
        <span>{action}</span>
        {evidence && <Pill className={evidence.className}>{t(`connectionsActivity.evidence.${evidence.key}`)}</Pill>}
      </p>
    </>
  )
}

function EventRow({ event, name, isNew }) {
  const { t } = useLanguage()
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="shrink-0" aria-hidden="true"><EventVisual event={event} /></span>
      <div className="min-w-0 flex-1">
        <p className="sr-only">{name} {describeActivityEvent(event, t)}</p>
        <div aria-hidden="true">
          <EventLines event={event} />
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        {isNew && (
          <>
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-moss" />
            <span className="sr-only">{t('connectionsActivity.newLabel')}</span>
          </>
        )}
        <time dateTime={event.event_at} title={formatAbsoluteDate(event.event_at)} className="text-xs text-secondary">
          {formatRelativeDate(event.event_at)}
        </time>
      </div>
    </li>
  )
}

// One person in the strip above the feed; a ring marks people with something
// new since the learner last looked.
function PersonChip({ name, avatarUrl, hasNew, selected, onClick, label, accessibleName }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={accessibleName}
      onClick={onClick}
      className={`shrink-0 w-16 flex flex-col items-center gap-1 rounded-md py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss ${
        selected ? 'text-ink' : 'text-secondary hover:text-ink'
      }`}
    >
      <span className={`rounded-full p-0.5 ${hasNew ? 'ring-2 ring-moss' : selected ? 'ring-2 ring-hairline' : ''}`}>
        {avatarUrl !== undefined
          ? <PersonAvatar name={name} avatarUrl={avatarUrl} size={10} />
          : (
            <span className="w-10 h-10 rounded-full border border-hairline bg-paper text-secondary flex items-center justify-center">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
                <circle cx="17" cy="9" r="2.5" /><path d="M17 14c2.6 0 4.5 1.8 4.5 4.5" />
              </svg>
            </span>
          )}
      </span>
      <span className={`text-xs truncate max-w-full ${selected ? 'font-medium' : ''}`}>{label}</span>
    </button>
  )
}

// What the learner's connections have been doing, aggregated across all of
// them (Connections.jsx). Events arrive newest first; lastSeenAt (a Date, or
// null on a first visit) marks the ones that arrived since the learner last
// looked.
export default function ConnectionsActivityFeed({ events, lastSeenAt = null, now = Date.now() }) {
  const { t } = useLanguage()
  const [selectedActor, setSelectedActor] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const grouped = useMemo(() => groupConnectionsActivity(events), [events])
  const isNew = (event) => lastSeenAt != null && new Date(event.event_at) > lastSeenAt

  const people = useMemo(() => {
    const byActor = new Map()
    for (const event of grouped) {
      if (!byActor.has(event.actor_id)) {
        byActor.set(event.actor_id, { actorId: event.actor_id, name: event.full_name, avatarUrl: event.avatar_url ?? null, hasNew: false })
      }
      if (lastSeenAt != null && new Date(event.event_at) > lastSeenAt) byActor.get(event.actor_id).hasNew = true
    }
    return [...byActor.values()]
  }, [grouped, lastSeenAt])

  const filtered = selectedActor ? grouped.filter((event) => event.actor_id === selectedActor) : grouped
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE)
  const sections = sectionedActivity(visible, now)
  const fallbackName = t('connectionsActivity.aConnection')

  return (
    <div>
      {people.length > 1 && (
        <div role="group" aria-label={t('connectionsActivity.people')} className="flex gap-1 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          <PersonChip
            label={t('connectionsActivity.everyone')}
            accessibleName={t('connectionsActivity.everyone')}
            selected={selectedActor === null}
            hasNew={false}
            onClick={() => setSelectedActor(null)}
          />
          {people.map((person) => (
            <PersonChip
              key={person.actorId}
              name={person.name}
              avatarUrl={person.avatarUrl}
              label={(person.name || fallbackName).split(' ')[0]}
              accessibleName={person.hasNew
                ? `${person.name || fallbackName} (${t('connectionsActivity.newLabel')})`
                : person.name || fallbackName}
              hasNew={person.hasNew}
              selected={selectedActor === person.actorId}
              onClick={() => {
                setSelectedActor(selectedActor === person.actorId ? null : person.actorId)
                setShowAll(false)
              }}
            />
          ))}
        </div>
      )}

      <div className="space-y-5">
        {sections.map((section) => {
          const newCount = section.people.reduce((sum, p) => sum + p.events.filter(isNew).length, 0)
          return (
            <section key={section.key} aria-label={t(`connectionsActivity.sections.${section.key}`)}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-secondary mb-2">
                {t(`connectionsActivity.sections.${section.key}`)}
                {newCount > 0 && <span className="normal-case tracking-normal text-moss"> · {t('connectionsActivity.newCount', { count: newCount })}</span>}
              </h3>
              <div className="bg-card border border-hairline rounded-lg divide-y divide-hairline/40">
                {section.people.map((person) => {
                  const name = person.name || fallbackName
                  return (
                    <div key={person.actorId} className="px-4 py-3">
                      <Link
                        to={`/skills-profile/${person.actorId}`}
                        className="flex items-center gap-2 w-fit group"
                      >
                        <PersonAvatar name={person.name} avatarUrl={person.avatarUrl} size={7} />
                        <span className="text-sm font-medium text-ink group-hover:text-moss group-hover:underline">{name}</span>
                      </Link>
                      <ul className="mt-1 sm:pl-9">
                        {person.events.map((event, i) => (
                          <EventRow
                            key={`${event.event_type}-${event.event_at}-${i}`}
                            event={event}
                            name={name}
                            isNew={isNew(event)}
                          />
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {filtered.length > INITIAL_VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-3 text-sm text-moss font-medium hover:underline"
        >
          {showAll ? t('connectionsActivity.showLess') : t('connectionsActivity.showMore', { count: filtered.length - INITIAL_VISIBLE })}
        </button>
      )}
    </div>
  )
}
