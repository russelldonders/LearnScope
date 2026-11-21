import GrowthRing from './GrowthRing'
import { LEVEL_LABELS } from '../lib/levels'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'
import { gradientPairFor } from '../lib/placeholderGradient'
import { useLanguage } from '../context/LanguageContext'
import { parseCourse, parseExperience } from '../lib/connectionsActivity'

const SHOWN_SKILLS = 3

// Turns one list_connections_activity (0063/0102) row into a plain-language
// sentence -- everything needed to say it is already in the row itself
// (skill_name/level/detail), never a client-side lookup, since each row is
// independently privacy-checked server-side and shouldn't need extra trust.
// Level labels stay English, as everywhere else they're shown. Read out to
// screen readers in place of the visual layout below.
function describeActivityEvent(event, t) {
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
    case 'course_planned':
      return t('connectionsActivity.coursePlanned', { detail: event.detail })
    case 'course_started':
      return t('connectionsActivity.courseStarted', { detail: event.detail })
    case 'course_completed':
      return t('connectionsActivity.courseCompleted', { detail: event.detail })
    case 'course_cancelled':
      return t('connectionsActivity.courseCancelled', { detail: event.detail })
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
    case 'course_planned':
    case 'course_started':
    case 'course_completed':
    case 'course_cancelled': {
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

  // A course's status changes, each its own event (planned, started,
  // completed, cancelled -- see 20261114110000).
  const courseAction = {
    course_planned: 'coursePlanned',
    course_started: 'courseStarted',
    course_completed: 'courseCompleted',
    course_cancelled: 'courseCancelled',
  }[event.event_type]
  if (courseAction) {
    const { name, provider } = parseCourse(event.detail)
    return (
      <>
        <p className="text-sm text-ink font-medium break-words">{name}</p>
        <p className="text-xs text-secondary">
          {t(`connectionsActivity.action.${courseAction}`)}{provider ? ` · ${provider}` : ''}
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

export function EventRow({ event, name, isNew }) {
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
