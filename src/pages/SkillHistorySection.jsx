import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { formatMonthYear, formatFullDate } from '../lib/dates'
import GrowthRing from '../components/GrowthRing'
import EvidenceAttachmentLink from '../components/EvidenceAttachmentLink'
import { LEVEL_LABELS, KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'
import { SKILL_SOURCE_LABELS } from '../lib/skillSource'
import { activityName, verbLabel, formatDuration, durationMinutes, formatMinutes, isDiagnosticStatement, isPeerRatingStatement, relatedExperienceFromStatement, experienceTrail, provenanceFromStatement, PROVENANCE_SOURCE_LABELS } from '../lib/xapiStatement'
import AccessibleDialog from '../components/AccessibleDialog'
import LifecycleStageIcon from '../components/LifecycleStageIcon'
import PendingTrainingEntry from '../components/PendingTrainingEntry'

const TIMELINE_DETAIL_TYPES = new Set(['assessment', 'peer', 'relationship', 'activity', 'activity-group', 'training'])

// Frequent syncs (e.g. Strava logging a run most days) can flood the
// Timeline with dozens of near-identical rows. Same verb + same calendar
// year collapses into one summary row ("Practiced it 12 times this year")
// that expands to the full list on click (see TimelineDetailModal); a verb
// that only happened once that year stays a normal single 'activity' row,
// unchanged from before this grouping existed.
function groupActivityEvents(practicalStatements) {
  const byGroup = new Map()
  for (const s of practicalStatements) {
    const verbId = s.statement.verb?.id ?? 'unknown'
    const year = new Date(s.recorded_at).getFullYear()
    const key = `${verbId}::${year}`
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key).push(s)
  }

  const events = []
  for (const group of byGroup.values()) {
    if (group.length === 1) {
      const s = group[0]
      events.push({ type: 'activity', date: s.recorded_at, createdAt: s.created_at, statement: s })
      continue
    }
    const sorted = [...group].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
    const latestCreatedAt = sorted.reduce(
      (latest, s) => (new Date(s.created_at) > new Date(latest) ? s.created_at : latest),
      sorted[0].created_at
    )
    events.push({
      type: 'activity-group',
      date: sorted[0].recorded_at,
      createdAt: latestCreatedAt,
      verbId: sorted[0].statement.verb?.id,
      verbLabel: verbLabel(sorted[0].statement),
      year: new Date(sorted[0].recorded_at).getFullYear(),
      count: sorted.length,
      totalMinutes: sorted.reduce((sum, s) => sum + durationMinutes(s.statement), 0),
      statements: sorted,
    })
  }
  return events
}

export function HistorySection({
  skill,
  assessorName,
  history,
  peerRatings,
  relationshipLinks,
  statements,
  courseLinks,
  validationRequests,
  validatorNames,
  loading,
  raterAvatars,
  highlightActivityId,
}) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  // The Confirming Baseline knowledge quiz logs its own xAPI attempt --
  // exclude it here too, same reasoning as the top-level SkillDetail
  // component (see there for the full comment).
  const practicalStatements = statements.filter((s) => !isDiagnosticStatement(s.statement) && !isPeerRatingStatement(s.statement))
  const pendingValidationRequests = validationRequests.filter((r) => r.status === 'pending')
  const decidedValidationRequests = validationRequests.filter((r) => r.status !== 'pending')
  const [selectedEvent, setSelectedEvent] = useState(null)

  // Arriving here from a dashboard/skill-list activity click -- jump
  // straight to that activity's detail rather than making the learner find
  // it themselves in a timeline that mixes assessments, ratings, training
  // and activities together.
  useEffect(() => {
    if (!highlightActivityId) return
    const match = statements.find((s) => s.id === highlightActivityId)
    if (match) setSelectedEvent({ type: 'activity', statement: match })
  }, [highlightActivityId, statements])

  function goToCourse(courseId) {
    navigate(`/courses/${courseId}/learn`, { state: { backTo: `/skills/${skill.id}`, backLabel: skill.name } })
  }

  return (
    <div className="mt-4 pt-4 border-t border-hairline">
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-3">{t('skillDetail.timeline')}</h3>

      {loading && <p className="text-sm text-secondary">{t('skillDetail.loading')}</p>}
      {!loading && (() => {
        // Enrolled-but-not-completed courses have no real date yet -- they
        // haven't happened. Rather than fake a date (which risked sorting
        // them below "today", as if already done), they render as pending
        // items above "today", the same way an unmet target does.
        const pendingCourseLinks = courseLinks.filter((link) => link.courses && !link.courses.completed_date)
        // An externally-imported skill's own row only says "external_import"
        // (generic across providers, see the skills_source_check migration)
        // -- the actual provider (e.g. Strava) lives on the synced xAPI
        // statement's provenance extension instead, so it's looked up here
        // to caption "Skill added" with who it really came from.
        const importProvenanceSource = provenanceFromStatement(
          statements.find((s) => provenanceFromStatement(s.statement))?.statement ?? {}
        )?.source
        const events = [
          ...history.map((entry) => ({ type: 'assessment', date: entry.assessed_at, createdAt: entry.created_at, entry })),
          ...peerRatings.map((rating) => ({ type: 'peer', date: rating.rated_at, createdAt: rating.rated_at, rating })),
          ...relationshipLinks
            .filter((link) => link.experience)
            .map((link) => ({
              type: 'relationship',
              date: link.experience.start_date,
              createdAt: link.created_at,
              link,
            })),
          ...groupActivityEvents(practicalStatements),
          ...courseLinks
            .filter((link) => link.courses?.completed_date)
            .map((link) => ({
              type: 'training',
              date: link.courses.completed_date,
              createdAt: link.created_at,
              link,
            })),
          ...decidedValidationRequests.map((request) => ({
            type: 'validation',
            date: request.decided_at,
            createdAt: request.decided_at,
            request,
          })),
          {
            type: 'added',
            date: skill.date_added,
            createdAt: skill.date_added,
            source: skill.source,
            provenanceSource: importProvenanceSource,
          },
          { type: 'today', date: new Date().toISOString(), createdAt: new Date().toISOString() },
          // Same-day events sort by day first, then by when the record was
          // actually created/assigned -- e.g. a course completed today
          // should rank above a skill added earlier today, even though both
          // show "today" as their display date.
        ].sort((a, b) => {
          const dayDiff = new Date(b.date).toISOString().slice(0, 10).localeCompare(
            new Date(a.date).toISOString().slice(0, 10)
          )
          if (dayDiff !== 0) return dayDiff
          return new Date(b.createdAt ?? b.date) - new Date(a.createdAt ?? a.date)
        })
        // "Most recent" and "Baseline" badges track the practical axis --
        // the axis GrowthRing in the header and skills.level are shown --
        // so a knowledge self-assessment shouldn't claim either badge.
        const mostRecentRatingIndex = events.findIndex(
          (e) => (e.type === 'assessment' && e.entry.axis === 'practical') || e.type === 'peer'
        )
        // The "Baseline" badge marks the most recent AI-assessed baseline
        // specifically -- self-assessments and peer ratings are additional
        // input toward an evaluation, not a baseline in their own right.
        const mostRecentBaselineIndex = events.findIndex(
          (e) => e.type === 'assessment' && e.entry.source === 'ai_baseline' && e.entry.axis === 'practical'
        )

        return (
          <div>
            {pendingCourseLinks.map((link, i) => (
              <PendingTrainingEntry
                key={link.id}
                link={link}
                hasMore={i < pendingCourseLinks.length - 1 || pendingValidationRequests.length > 0 || events.length > 0}
                onClick={() => goToCourse(link.courses.id)}
              />
            ))}
            {pendingValidationRequests.map((request, i) => (
              <PendingValidationEntry
                key={request.id}
                request={request}
                validatorName={validatorNames[request.validator_id]}
                hasMore={i < pendingValidationRequests.length - 1 || events.length > 0}
              />
            ))}
            {events.map((event, i) => (
              <TimelineEntry
                key={
                  event.entry?.id ?? event.rating?.id ?? event.link?.id ?? event.statement?.id ??
                  event.request?.id ?? (event.type === 'activity-group' ? `${event.verbId}::${event.year}` : event.type)
                }
                event={event}
                isLast={i === events.length - 1}
                isMostRecent={i === mostRecentRatingIndex}
                isBaseline={i === mostRecentBaselineIndex}
                raterAvatars={raterAvatars}
                assessorName={assessorName}
                onSelect={
                  event.type === 'training'
                    ? () => goToCourse(event.link.courses.id)
                    : TIMELINE_DETAIL_TYPES.has(event.type)
                      ? () => setSelectedEvent(event)
                      : undefined
                }
              />
            ))}
          </div>
        )
      })()}

      {selectedEvent && (
        <TimelineDetailModal
          event={selectedEvent}
          knowledgeLevelGuide={skill.knowledge_level_guide}
          raterAvatars={raterAvatars}
          assessorName={assessorName}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}

function PendingValidationEntry({ request, validatorName, hasMore }) {
  const { t } = useLanguage()
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <div className="flex items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-hairline">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40" />
        </div>
        {hasMore && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper/60 p-3">
        <p className="text-sm text-secondary">
          {t('skillDetail.waitingOnPrefix')} <span className="text-ink font-medium">{validatorName || t('skillDetail.aValidator')}</span> {t('skillDetail.toConfirmSuffix')}{' '}
          {LEVEL_LABELS[request.target_level]}
        </p>
      </div>
    </div>
  )
}

export function TimelineEntry({
  event,
  isLast,
  isMostRecent,
  isBaseline,
  raterAvatars,
  assessorName,
  onSelect,
}) {
  const { t } = useLanguage()
  const boxClass = 'rounded-md border border-hairline bg-paper p-3'
  const clickableProps = onSelect
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: onSelect,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        },
      }
    : {}

  if (event.type === 'today') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-2.5 h-2.5 rounded-full bg-ink shrink-0" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink font-semibold">
            {t('skillDetail.today')} · {formatFullDate(event.date)}
          </span>
          <span className="flex-1 h-px bg-hairline" />
        </div>
      </div>
    )
  }

  if (event.type === 'activity') {
    const s = event.statement
    const relatedExperience = relatedExperienceFromStatement(s.statement)
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className={`min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3 ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
          {...clickableProps}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">{verbLabel(s.statement)}</span>
            <p className="text-sm font-medium text-ink truncate min-w-0">{activityName(s.statement)}</p>
          </div>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {new Date(s.recorded_at).toLocaleDateString()}
            {formatDuration(s.statement) ? ` · ${formatDuration(s.statement)}` : ''}
          </p>
          {relatedExperience && (
            <p className="font-mono text-[10px] text-secondary mt-0.5 truncate">{experienceTrail(relatedExperience)}</p>
          )}
        </div>
      </div>
    )
  }

  if (event.type === 'activity-group') {
    const totalLabel = formatMinutes(event.totalMinutes)
    const yearLabel = event.year === new Date().getFullYear() ? t('skillDetail.thisYear') : `${t('skillDetail.inYearPrefix')} ${event.year}`
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className={`min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3 ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
          {...clickableProps}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">{event.verbLabel}</span>
            <p className="text-sm font-medium text-ink truncate min-w-0">{event.count} {t('skillDetail.timesSuffix')} {yearLabel}</p>
          </div>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {totalLabel ? `${t('skillDetail.totalPrefix')} ${totalLabel}` : `${event.count} ${t('skillDetail.activitiesWord')}`}
          </p>
          {onSelect && <p className="font-mono text-[10px] text-moss mt-1">{t('skillDetail.viewAllArrow')}</p>}
        </div>
      </div>
    )
  }

  if (event.type === 'training') {
    const course = event.link.courses
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className={`min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3 ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
          {...clickableProps}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">{t('skillDetail.trainingLabel')}</span>
            <p className="text-sm font-medium text-ink truncate min-w-0">{course.name}</p>
          </div>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {formatFullDate(course.completed_date)}
          </p>
          {onSelect && <p className="font-mono text-[10px] text-moss mt-1">{t('skillDetail.viewCourseArrow')}</p>}
        </div>
      </div>
    )
  }

  if (event.type === 'added') {
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <LifecycleStageIcon stage="identified" size={14} className="text-secondary/70 mt-1" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
          <p className="text-sm font-medium text-ink">{t('skillDetail.skillAdded')}</p>
          {event.source && (
            <p className="font-mono text-[10px] text-secondary mt-0.5">
              {event.provenanceSource
                ? `${t('skillDetail.syncedFromPrefix')} ${PROVENANCE_SOURCE_LABELS[event.provenanceSource] ?? event.provenanceSource}`
                : SKILL_SOURCE_LABELS[event.source] ?? event.source}
            </p>
          )}
          <p className="font-mono text-xs text-secondary mt-0.5">
            {formatFullDate(event.date)}
          </p>
        </div>
      </div>
    )
  }

  if (event.type === 'peer') {
    const rating = event.rating
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <GrowthRing level={rating.level} size={isMostRecent ? 48 : 32} />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className={`min-w-0 flex-1 mb-6 ${boxClass} ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
          {...clickableProps}
        >
          <p className={isMostRecent ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}>
            {LEVEL_LABELS[rating.level]}
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {new Date(rating.rated_at).toLocaleDateString()}
          </p>
          <p className="font-mono text-[10px] text-secondary mt-0.5 flex items-center gap-1.5">
            <RaterAvatar url={raterAvatars?.[rating.rater_id]} />
            {t('skillDetail.ratedByPrefix')} {rating.rater_name || rating.rater_email || t('skillDetail.aConnection')}
          </p>
          {rating.comments && <p className="text-sm text-ink mt-1">{rating.comments}</p>}
        </div>
      </div>
    )
  }

  if (event.type === 'relationship') {
    const { link } = event
    const exp = link.experience
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-hairline bg-paper">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <path d="M3 7l9-4 9 4-9 4-9-4z" />
              <path d="M3 12l9 4 9-4" />
              <path d="M3 17l9 4 9-4" />
            </svg>
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          className={`min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3 ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
          {...clickableProps}
        >
          <p className="text-sm font-medium text-ink">{exp.title}</p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {formatMonthYear(exp.start_date)} – {exp.end_date ? formatMonthYear(exp.end_date) : t('skillDetail.present')}
          </p>
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {exp.type === 'education' ? t('skillDetail.developedDuringEducation') : t('skillDetail.usedDuringEmployment')} · {exp.organization}
          </p>
        </div>
      </div>
    )
  }

  if (event.type === 'validation') {
    const { request } = event
    const confirmed = request.status === 'confirmed'
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full border ${
              confirmed ? 'border-moss bg-moss/10' : 'border-hairline bg-paper'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={confirmed ? 'text-moss' : 'text-secondary'}>
              {confirmed ? <path d="M20 6L9 17l-5-5" /> : <path d="M18 6L6 18M6 6l12 12" />}
            </svg>
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
          <p className="text-sm font-medium text-ink">
            {confirmed ? `${t('skillDetail.validatedAtPrefix')} ${LEVEL_LABELS[request.target_level]}` : t('skillDetail.validationDeclined')}
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {new Date(request.decided_at).toLocaleDateString()}
          </p>
          {request.decision_comments && <p className="text-sm text-ink mt-1">"{request.decision_comments}"</p>}
        </div>
      </div>
    )
  }

  const entry = event.entry
  const entryLabels = entry.axis === 'knowledge' ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
  const paths = entry.evidence_paths?.length
    ? entry.evidence_paths
    : entry.evidence_path
      ? [entry.evidence_path]
      : []

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <GrowthRing
          level={entry.level}
          size={isMostRecent ? 48 : 32}
          labels={entryLabels}
          color={entry.axis === 'knowledge' ? 'var(--color-slate)' : undefined}
        />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div
        className={`min-w-0 flex-1 mb-6 ${boxClass} ${onSelect ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
        {...clickableProps}
      >
        <div className="flex items-center gap-2">
          <p className={isMostRecent ? 'text-base font-semibold text-ink' : 'text-sm font-medium text-ink'}>
            {entryLabels[entry.level]}
          </p>
          {entry.axis === 'knowledge' && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5">
              {t('skillDetail.knowledge')}
            </span>
          )}
          {isBaseline && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-moss border border-moss rounded-full px-2 py-0.5">
              {t('skillDetail.baseline')}
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-secondary mt-0.5">
          {new Date(entry.assessed_at).toLocaleDateString()}
        </p>
        {entry.source === 'course' && entry.courses?.name ? (
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {t('skillDetail.earnedByCompletingPrefix')} {entry.courses.name}
          </p>
        ) : entry.source === 'ai_baseline' ? (
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {t('skillDetail.aiAssessedBaselineDescription')}
          </p>
        ) : entry.source === 'ai_evaluation' ? (
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {t('skillDetail.aiEvaluationDescription')}
          </p>
        ) : entry.source === 'diagnostic_confirmed' ? (
          <p className="font-mono text-[10px] text-secondary mt-0.5">{t('skillDetail.confirmedViaKnowledgeCheck')}</p>
        ) : (
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {t('skillDetail.selfAssessedByPrefix')} {assessorName || t('skillDetail.you')}
          </p>
        )}
        {entry.experience?.title && (
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {t('skillDetail.duringPrefix')} {entry.experience.title} · {entry.experience.organization}
          </p>
        )}
        {entry.comments && <p className="text-sm text-ink mt-1">{entry.comments}</p>}
        {(entry.evidence_url || paths.length > 0) && (
          <div className="mt-2">
            <h5 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">
              {t('skillDetail.evidence')}
            </h5>
            <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {entry.evidence_url && (
              <a
                href={entry.evidence_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-moss font-medium"
              >
                {t('skillDetail.evidenceLink')}
              </a>
            )}
            {paths.map((path, i) => (
              <EvidenceAttachmentLink key={path} path={path} index={i} />
            ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function TimelineDetailModal({ event, knowledgeLevelGuide, raterAvatars, assessorName, onClose }) {
  const { t } = useLanguage()
  let title = t('skillDetail.details')
  let body = null

  if (event.type === 'assessment') {
    const entry = event.entry
    const entryLabels = entry.axis === 'knowledge' ? KNOWLEDGE_LEVEL_LABELS : LEVEL_LABELS
    const paths = entry.evidence_paths?.length
      ? entry.evidence_paths
      : entry.evidence_path
        ? [entry.evidence_path]
        : []
    title = entryLabels[entry.level]
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <GrowthRing
            level={entry.level}
            size={48}
            labels={entryLabels}
            color={entry.axis === 'knowledge' ? 'var(--color-slate)' : undefined}
          />
          <p className="font-mono text-xs text-secondary">
            {new Date(entry.assessed_at).toLocaleDateString()}
          </p>
          {entry.axis === 'knowledge' && (
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5">
              {t('skillDetail.knowledge')}
            </span>
          )}
        </div>
        {entry.axis === 'knowledge' && knowledgeLevelGuide?.[entry.level - 1] && (
          <p className="text-sm text-ink bg-paper border border-hairline rounded-md p-2">
            {knowledgeLevelGuide[entry.level - 1]}
          </p>
        )}
        {entry.source === 'course' && entry.courses?.name ? (
          <p className="text-sm text-secondary">{t('skillDetail.earnedByCompletingPrefix')} {entry.courses.name}</p>
        ) : entry.source === 'ai_baseline' ? (
          <p className="text-sm text-secondary">
            {t('skillDetail.aiAssessedBaselineDescription')}
          </p>
        ) : entry.source === 'ai_evaluation' ? (
          <p className="text-sm text-secondary">{t('skillDetail.aiEvaluationDescription')}</p>
        ) : entry.source === 'diagnostic_confirmed' ? (
          <p className="text-sm text-secondary">{t('skillDetail.confirmedViaKnowledgeCheck')}</p>
        ) : (
          <p className="text-sm text-secondary">{t('skillDetail.selfAssessedByPrefix')} {assessorName || t('skillDetail.you')}</p>
        )}
        {entry.experience?.title && (
          <p className="text-sm text-secondary">
            {t('skillDetail.duringPrefix')} {entry.experience.title} · {entry.experience.organization}
          </p>
        )}
        {entry.comments && <p className="text-sm text-ink">{entry.comments}</p>}
        {(entry.evidence_url || paths.length > 0) && (
          <div>
            <h5 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">{t('skillDetail.evidence')}</h5>
            <div className="flex flex-wrap items-center gap-3">
              {entry.evidence_url && (
                <a
                  href={entry.evidence_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-moss font-medium"
                >
                  {t('skillDetail.evidenceLink')}
                </a>
              )}
              {paths.map((path, i) => (
                <EvidenceAttachmentLink key={path} path={path} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  } else if (event.type === 'peer') {
    const rating = event.rating
    title = LEVEL_LABELS[rating.level]
    body = (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <GrowthRing level={rating.level} size={48} />
          <p className="font-mono text-xs text-secondary">
            {new Date(rating.rated_at).toLocaleDateString()}
          </p>
        </div>
        <p className="text-sm text-secondary flex items-center gap-1.5">
          <RaterAvatar url={raterAvatars?.[rating.rater_id]} size={20} />
          {t('skillDetail.ratedByPrefix')} {rating.rater_name || rating.rater_email || t('skillDetail.aConnection')}
        </p>
        {rating.comments && <p className="text-sm text-ink">{rating.comments}</p>}
      </div>
    )
  } else if (event.type === 'relationship') {
    const exp = event.link.experience
    title = exp.title
    body = (
      <div className="space-y-2">
        <p className="font-mono text-xs text-secondary">
          {formatMonthYear(exp.start_date)} – {exp.end_date ? formatMonthYear(exp.end_date) : t('skillDetail.present')}
        </p>
        <p className="text-sm text-secondary">
          {exp.type === 'education' ? t('skillDetail.developedDuringEducation') : t('skillDetail.usedDuringEmployment')} · {exp.organization}
        </p>
      </div>
    )
  } else if (event.type === 'activity') {
    const s = event.statement
    const evidencePaths = s.evidence_paths ?? []
    const relatedExperience = relatedExperienceFromStatement(s.statement)
    title = activityName(s.statement)
    body = (
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">{verbLabel(s.statement)}</p>
        <p className="font-mono text-xs text-secondary">
          {new Date(s.recorded_at).toLocaleDateString()}
          {formatDuration(s.statement) ? ` · ${formatDuration(s.statement)}` : ''}
        </p>
        {relatedExperience && (
          <p className="font-mono text-xs text-secondary">{experienceTrail(relatedExperience)}</p>
        )}
        {s.statement.object?.definition?.description?.['en-US'] && (
          <p className="text-sm text-ink">{s.statement.object.definition.description['en-US']}</p>
        )}
        {(s.evidence_url || evidencePaths.length > 0) && (
          <div>
            <h5 className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-1">{t('skillDetail.evidence')}</h5>
            <div className="flex flex-wrap items-center gap-3">
              {s.evidence_url && (
                <a
                  href={s.evidence_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-moss font-medium"
                >
                  {t('skillDetail.evidenceLink')}
                </a>
              )}
              {evidencePaths.map((path, i) => (
                <EvidenceAttachmentLink key={path} path={path} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    )
  } else if (event.type === 'activity-group') {
    title = `${event.verbLabel} · ${event.count} ${t('skillDetail.timesSuffix')}`
    body = (
      <div className="space-y-2">
        {event.statements.map((s) => {
          const relatedExperience = relatedExperienceFromStatement(s.statement)
          return (
            <div key={s.id} className="rounded-md border border-hairline bg-paper p-2">
              <p className="text-sm font-medium text-ink">{activityName(s.statement)}</p>
              <p className="font-mono text-xs text-secondary mt-0.5">
                {new Date(s.recorded_at).toLocaleDateString()}
                {formatDuration(s.statement) ? ` · ${formatDuration(s.statement)}` : ''}
              </p>
              {relatedExperience && (
                <p className="font-mono text-[10px] text-secondary mt-0.5">{experienceTrail(relatedExperience)}</p>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <AccessibleDialog
      label={title}
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="font-display text-xl text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-secondary hover:text-ink text-sm">
            {t('skillDetail.close')}
          </button>
        </div>
        {body}
    </AccessibleDialog>
  )
}

function RaterAvatar({ url, size = 16 }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full border border-hairline bg-paper overflow-hidden shrink-0"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-secondary"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </svg>
      )}
    </span>
  )
}
