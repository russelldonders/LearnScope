import { Link } from 'react-router-dom'
import EvidenceAttachmentLink from './EvidenceAttachmentLink'
import EvidenceThumbnail from './EvidenceThumbnail'
import { isImagePath } from '../lib/skillEvidence'
import GrowthRing from './GrowthRing'
import {
  activityName,
  verbLabel,
  relatedSkillsFromStatement,
  relatedExperienceFromStatement,
  experienceTrail,
  formatDuration,
  formatMeasurements,
} from '../lib/xapiStatement'
import { XAPI_VERB_BY_IRI } from '../lib/xapiVerbs'
import { activitySource, checkInLevel, isCheckIn, isJustAdded } from '../lib/activityTimeline'
import { gradientPairFor } from '../lib/placeholderGradient'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'
import { useLanguage } from '../context/LanguageContext'

// The verb in plain words ("Practised"), falling back to what's stored for
// verbs from elsewhere (e.g. course packages).
function plainVerb(statement, t) {
  const value = XAPI_VERB_BY_IRI[statement.verb?.id]?.value
  if (!value) return verbLabel(statement)
  const key = `activity.verbs.${value}`
  const label = t(key)
  return label === key ? verbLabel(statement) : label
}

// Each skill keeps the same colour everywhere it appears.
function SkillChip({ skill }) {
  const [colour] = gradientPairFor(skill.name ?? '')
  return (
    <Link
      to={`/skills/${skill.id}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 rounded-full border border-hairline/70 px-2 py-0.5 text-xs text-ink hover:border-moss hover:text-moss"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: colour }} />
      {skill.name}
    </Link>
  )
}

function Figure({ children }) {
  return <span className="text-sm font-medium text-ink tabular-nums whitespace-nowrap">{children}</span>
}

// A knowledge check-in or a connection's rating: something the app recorded
// rather than something the learner did, so it stays compact.
function CheckInLine({ row }) {
  const { t } = useLanguage()
  const level = checkInLevel(row)
  return (
    <div className="flex items-center gap-2 min-w-0">
      {level && <span aria-hidden="true" className="shrink-0"><GrowthRing level={level} size={22} color="var(--color-slate)" /></span>}
      <p className="text-xs text-secondary min-w-0 break-words">
        <span className="font-medium text-ink">{t('activity.timeline.checkIn')}</span> · {activityName(row.statement)}
      </p>
    </div>
  )
}

// A single logged activity, shared by the dashboard's timeline and the full
// /activity page so the two never drift apart. The page shows each as a
// clickable card with its date; the timeline (framed=false) has day headings
// instead, so the title is the link to the activity and actions sit below.
export default function ActivityRow({ row, onClick, framed = true, now = Date.now(), actions = null, children }) {
  const { t } = useLanguage()
  const statement = row.statement
  const title = activityName(statement)

  if (isCheckIn(row)) {
    return (
      <div className={framed ? 'bg-card border border-hairline rounded-lg px-4 py-2.5' : ''}>
        <CheckInLine row={row} />
        {framed && (
          <p className="text-xs text-secondary mt-0.5" title={formatAbsoluteDate(row.recorded_at)}>
            {formatRelativeDate(row.recorded_at)}
          </p>
        )}
      </div>
    )
  }

  const relatedSkills = relatedSkillsFromStatement(statement)
  const relatedExperience = relatedExperienceFromStatement(statement)
  const { source, note, distance } = activitySource(statement)
  const figures = [
    ...(formatMeasurements(statement) ? formatMeasurements(statement).split(' · ') : []),
    distance,
    formatDuration(statement),
  ].filter(Boolean)
  const evidencePaths = row.evidence_paths ?? []
  const imagePaths = evidencePaths.filter(isImagePath)
  const otherPaths = evidencePaths.filter((path) => !isImagePath(path))
  const clickableCard = framed && onClick
  const justAdded = !framed && isJustAdded(row, now)

  return (
    <div
      role={clickableCard ? 'button' : undefined}
      tabIndex={clickableCard ? 0 : undefined}
      onClick={clickableCard ? onClick : undefined}
      onKeyDown={(e) => {
        if (clickableCard && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      className={framed
        ? `bg-card border border-hairline rounded-lg px-4 py-3 ${clickableCard ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`
        : ''}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {!framed && onClick ? (
            <button type="button" onClick={onClick} className="text-left text-sm font-medium text-ink hover:text-moss hover:underline break-words">
              {title}
            </button>
          ) : (
            <p className="text-sm font-medium text-ink break-words">{title}</p>
          )}
          <p className="text-xs text-secondary mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{plainVerb(statement, t)}</span>
            {framed && (
              <span title={formatAbsoluteDate(row.recorded_at)}>· {formatRelativeDate(row.recorded_at)}</span>
            )}
            {justAdded && (
              <span className="rounded-full bg-gold/15 text-gold px-1.5 py-px text-[11px]">{t('activity.timeline.justAdded')}</span>
            )}
            {actions}
          </p>
        </div>
        {figures.length > 0 && (
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            {figures.map((figure, i) => <Figure key={i}>{figure}</Figure>)}
          </div>
        )}
      </div>

      {(relatedSkills.length > 0 || relatedExperience || source) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {relatedSkills.map((skill) => <SkillChip key={skill.id} skill={skill} />)}
          {relatedExperience && (
            <span className="rounded-full border border-hairline/70 px-2 py-0.5 text-xs text-secondary">{experienceTrail(relatedExperience)}</span>
          )}
          {source && (
            <span className="rounded-full bg-paper border border-hairline/70 px-2 py-0.5 text-xs text-secondary">
              {t('activity.timeline.via', { source })}
            </span>
          )}
        </div>
      )}

      {note && <p className="text-sm text-secondary mt-2 whitespace-pre-line break-words">{note}</p>}

      {imagePaths.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
          {imagePaths.map((path) => (
            <EvidenceThumbnail key={path} path={path} index={evidencePaths.indexOf(path)} />
          ))}
        </div>
      )}
      {(row.evidence_url || otherPaths.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mt-1" onClick={(e) => e.stopPropagation()}>
          {row.evidence_url && (
            <a href={row.evidence_url} target="_blank" rel="noopener noreferrer" className="text-xs text-moss font-medium">
              {t('skillDetail.evidenceLink')}
            </a>
          )}
          {otherPaths.map((path) => (
            <EvidenceAttachmentLink key={path} path={path} index={evidencePaths.indexOf(path)} />
          ))}
        </div>
      )}
      {children}
    </div>
  )
}
