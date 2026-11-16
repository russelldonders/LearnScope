import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { formatMonthYear, formatFullDate } from '../lib/dates'
import { LEVEL_LABELS } from '../lib/levels'
import { EXPERIENCE_TYPE_CONFIG, formatStudyDuration } from '../lib/experienceTypes'
import GrowthRing from '../components/GrowthRing'
import ChildExperienceEntry from '../components/ChildExperienceEntry'
import EvidenceAttachmentLink from '../components/EvidenceAttachmentLink'
import { activityName, relatedSkillsFromStatement, verbLabel } from '../lib/xapiStatement'
import PendingTrainingEntry from '../components/PendingTrainingEntry'
import { activityIncludesSkill, buildExperienceTimelineEvents, getDevelopedSkills } from '../lib/experienceDetail'

// The experience page's Overview tab: its timeline and the skills developed
// during it (see ExperienceDetail.jsx).

export function OverviewTab({ item, linkedCourses, skillLinks, skillHistory, achievements, childExperiences, activities, allActivities, loaded, highlightActivityId }) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  if (!loaded) return <p className="text-sm text-secondary">{t('common.loading')}</p>

  function goToCourse(courseId) {
    navigate(`/courses/${courseId}/learn`, { state: { backTo: `/experience/${item.id}`, backLabel: item.title } })
  }

  const pendingCourseLinks = linkedCourses.filter((l) => l.courses && !l.courses.completed_date)
  const events = buildExperienceTimelineEvents(item, childExperiences, linkedCourses, achievements, activities)
  const total = pendingCourseLinks.length + events.length

  return (
    <div className="space-y-6">
      {item.description && <p className="text-sm text-ink whitespace-pre-line">{item.description}</p>}
      {formatStudyDuration(item) && (
        <p className="text-sm text-secondary"><span className="font-medium text-ink">{t('experience.durationOfStudyPrefix')}</span> {formatStudyDuration(item)}</p>
      )}

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-3">{t('experience.timelineHeading')}</h4>
        {pendingCourseLinks.map((link, i) => (
          <PendingTrainingEntry
            key={link.id}
            link={link}
            hasMore={i < total - 1}
            onClick={() => goToCourse(link.courses.id)}
          />
        ))}
        {events.map((event, i) => (
          <ExperienceTimelineEntry
            key={event.child?.id ?? event.link?.id ?? event.entry?.id ?? event.activity?.id ?? event.type}
            item={item}
            event={event}
            isLast={pendingCourseLinks.length + i === total - 1}
            onSelectCourse={goToCourse}
            highlighted={event.type === 'activity' && event.activity.id === highlightActivityId}
          />
        ))}
      </div>

      <div>
        <h4 className="font-mono text-xs uppercase tracking-wide text-secondary mb-2">{t('experience.skillsDevelopedHeading')}</h4>
        {skillLinks.length === 0 ? (
          <p className="text-sm text-secondary">{t('experience.noSkillsLinkedYet')}</p>
        ) : (
          <SkillDevelopmentList item={item} skillLinks={skillLinks} assessments={skillHistory} activities={allActivities} />
        )}
      </div>
    </div>
  )
}

function SkillDevelopmentList({ item, skillLinks, assessments, activities = [] }) {
  const { t } = useLanguage()
  const [expandedSkillId, setExpandedSkillId] = useState(null)
  // "Skills developed" is scoped to skills with real logged activity against
  // this experience -- a skill that's merely been added/linked here, with
  // nothing practiced yet, is "what they're working on" (see the Skills
  // tab), not evidence of development.
  const activeLinks = skillLinks.filter((link) =>
    activities.some((activity) => activityIncludesSkill(activity, link.skill_id))
  )
  const developedSkills = getDevelopedSkills(activeLinks, assessments, item)
  const developedIds = new Set(developedSkills.map(({ link }) => link.skill_id))
  // A skill can have real logged activity but no measured before/after
  // level change yet -- worth showing as "worked on" evidence, distinct
  // from (and without overclaiming) the measured growth comparison below.
  // Per "evidence over unsupported claims", this never implies proficiency
  // increased.
  const otherLinks = activeLinks.filter((link) => !developedIds.has(link.skill_id))

  return (
    <div className="space-y-3">
      {developedSkills.length > 0 && (
        <ul className="overflow-hidden rounded-md border border-hairline divide-y divide-hairline">
          {developedSkills.map(({ link, progress }) => {
            const expanded = expandedSkillId === link.skill_id
            const activityCount = activities.filter((activity) => activityIncludesSkill(activity, link.skill_id)).length
            return (
              <li key={link.skill_id} className="bg-paper/40">
                <div className="p-3">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex items-baseline gap-2">
                      <Link
                        to={`/skills/${link.skill_id}`}
                        state={{ from: `/experience/${item.id}`, fromLabel: item.title }}
                        className="text-sm font-medium text-ink hover:text-moss hover:underline truncate"
                      >
                        {link.skills?.name}
                      </Link>
                      {activityCount > 0 && (
                        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
                          {activityCount} {activityCount === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded ? t('experience.hideSkillProgress') : t('experience.showSkillProgress')}
                      onClick={() => setExpandedSkillId(expanded ? null : link.skill_id)}
                      className="shrink-0 p-1 -m-1 rounded-md hover:bg-paper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        className={`h-4 w-4 shrink-0 text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
                      >
                        <path d="m5.5 7.5 4.5 4 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedSkillId(expanded ? null : link.skill_id)}
                    className="mt-2 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 text-left rounded-md hover:bg-paper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss focus-visible:ring-inset"
                  >
                    <SkillLevelPoint label={t('experience.atRoleStart')} level={progress.entryLevel} />
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-secondary">
                      <path d="M3.5 10h13m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <SkillLevelPoint label={t(progress.endLabel)} level={progress.endLevel} align="right" />
                  </button>
                </div>
                {expanded && <SkillProgressHistory progress={progress} />}
              </li>
            )
          })}
        </ul>
      )}

      {otherLinks.length > 0 && (
        <ul className="space-y-1.5">
          {otherLinks.map((link) => {
            const activityCount = activities.filter((activity) => activityIncludesSkill(activity, link.skill_id)).length
            return (
              <li
                key={link.skill_id}
                className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-paper/40 px-3 py-2"
              >
                <Link
                  to={`/skills/${link.skill_id}`}
                  state={{ from: `/experience/${item.id}`, fromLabel: item.title }}
                  className="text-sm text-ink hover:text-moss hover:underline truncate"
                >
                  {link.skills?.name}
                </Link>
                <span className="font-mono text-[10px] uppercase tracking-wide text-secondary shrink-0">
                  {activityCount} {activityCount === 1 ? t('skillDetail.activityLoggedSingular') : t('skillDetail.activityLoggedPlural')}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SkillLevelPoint({ label, level, align = 'left' }) {
  const { t } = useLanguage()
  return (
    <span className={`flex min-w-0 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <GrowthRing level={level} size={36} />
      <span className="min-w-0">
        <span className="block font-mono text-[10px] uppercase tracking-wide text-secondary">{label}</span>
        <span className="mt-0.5 block text-sm text-ink">{t('experience.levelAndLabel', { level, label: LEVEL_LABELS[level] })}</span>
      </span>
    </span>
  )
}

function SkillProgressHistory({ progress }) {
  const { t } = useLanguage()
  return (
    <div className="border-t border-hairline bg-card px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-secondary mb-2">{t('experience.historyDuringRole')}</p>
      {progress.duringRole.length === 0 ? (
        <p className="text-sm text-secondary">{t('experience.noAssessmentsDuringRole')}</p>
      ) : (
        <ol className="space-y-2">
          {progress.duringRole.map((entry) => (
            <li key={entry.id} className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
              <GrowthRing level={entry.level} size={28} />
              <div className="min-w-0">
                <p className="text-ink">{t('experience.levelAndLabel', { level: entry.level, label: LEVEL_LABELS[entry.level] })}</p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-secondary">
                  {formatFullDate(entry.assessed_at)}
                </p>
                {entry.comments && <p className="mt-1 text-secondary">{entry.comments}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function FlagIcon({ className }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 3v18" />
      <path d="M5 4h13l-2.5 4.5L18 13H5" />
    </svg>
  )
}

function ExperienceTimelineEntry({ item, event, isLast, onSelectCourse, highlighted }) {
  const { t } = useLanguage()
  if (event.type === 'start' || event.type === 'end') {
    const config = EXPERIENCE_TYPE_CONFIG[item.type] ?? EXPERIENCE_TYPE_CONFIG.employment
    const isSubExperience = Boolean(item.parent_experience_id)
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-full border border-hairline bg-paper">
            <FlagIcon className="text-secondary" />
          </div>
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
          <p className="text-sm font-medium text-ink capitalize">
            {event.type === 'start'
              ? t('experience.periodStarted', { period: config.periodNoun })
              : t('experience.periodEnded', { period: config.periodNoun })}
          </p>
          <p className="font-mono text-xs text-secondary mt-0.5">
            {isSubExperience ? formatFullDate(event.date) : formatMonthYear(event.date)}
          </p>
        </div>
      </div>
    )
  }

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

  if (event.type === 'child') {
    return <ChildExperienceEntry child={event.child} isLast={isLast} />
  }

  if (event.type === 'course') {
    const course = event.link.courses
    return (
      <div className="flex gap-3">
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelectCourse(course.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelectCourse(course.id)
            }
          }}
          className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary cursor-pointer hover:text-ink transition-colors"
        >
          <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">{t('skillDetail.trainingLabel')}</span>
          <span className="truncate min-w-0">{course.name}</span>
          <span className="font-mono text-[10px] text-secondary/70 shrink-0">
            {formatFullDate(course.completed_date)}
          </span>
        </div>
      </div>
    )
  }

  if (event.type === 'activity') {
    const row = event.activity
    const evidencePaths = row.evidence_paths ?? []
    const rowSkills = relatedSkillsFromStatement(row.statement)
    return (
      <div
        className="flex gap-3"
        ref={(el) => {
          if (el && highlighted) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}
      >
        <div className="flex flex-col items-center w-12 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-moss shrink-0 mt-1.5" />
          {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
        </div>
        <div className={`min-w-0 flex-1 mb-3 ${highlighted ? 'rounded-md ring-2 ring-moss p-2 -m-2' : ''}`}>
          <p className="text-sm text-ink break-words">
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{verbLabel(row.statement)}</span>{' '}
            {activityName(row.statement)}
          </p>
          <p className="font-mono text-[10px] text-secondary mt-0.5">
            {rowSkills.length > 0 ? `${rowSkills.map((s) => s.name).join(', ')} · ` : ''}{formatFullDate(row.recorded_at)}
          </p>
          {(row.evidence_url || evidencePaths.length > 0) && (
            <div className="flex flex-wrap items-center gap-3 mt-1">
              {row.evidence_url && (
                <a
                  href={row.evidence_url}
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
          )}
        </div>
      </div>
    )
  }

  const entry = event.entry
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <GrowthRing level={entry.level} size={32} />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div className="min-w-0 flex-1 mb-6 rounded-md border border-hairline bg-paper p-3">
        <p className="text-sm font-medium text-ink">
          {entry.skills?.name} <span className="text-secondary font-normal">· {LEVEL_LABELS[entry.level]}</span>
        </p>
        <p className="font-mono text-xs text-secondary mt-0.5">{new Date(entry.assessed_at).toLocaleDateString()}</p>
        {entry.comments && <p className="text-sm text-ink mt-1">{entry.comments}</p>}
      </div>
    </div>
  )
}
