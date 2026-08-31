import EvidenceAttachmentLink from './EvidenceAttachmentLink'
import { activityName, verbLabel, relatedSkillFromStatement, relatedExperienceFromStatement, experienceTrail, formatDuration } from '../lib/xapiStatement'
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates'

// A single logged skill activity, shared by the dashboard's capped "Skill
// activity" list and the full /activity page -- same card, same optional
// click-to-navigate behaviour, so the two never drift apart visually.
export default function ActivityRow({ row, onClick }) {
  const relatedSkill = relatedSkillFromStatement(row.statement)
  const relatedExperience = relatedExperienceFromStatement(row.statement)
  const duration = formatDuration(row.statement)
  const evidencePaths = row.evidence_paths ?? []

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      className={`bg-card border border-hairline rounded-lg px-4 py-3 ${onClick ? 'cursor-pointer hover:border-moss/60 transition-colors' : ''}`}
    >
      <p className="text-sm text-ink">
        <span className="font-mono text-[11px] uppercase tracking-wide text-secondary">
          {verbLabel(row.statement)}
        </span>{' '}
        {activityName(row.statement)}
      </p>
      <p className="font-mono text-xs text-secondary mt-0.5" title={formatAbsoluteDate(row.recorded_at)}>
        {formatRelativeDate(row.recorded_at)}
        {duration ? ` · ${duration}` : ''}
        {relatedSkill ? ` · ${relatedSkill.name}` : ''}
        {relatedExperience ? ` · ${experienceTrail(relatedExperience)}` : ''}
      </p>
      {row.statement.object?.definition?.description?.['en-US'] && (
        <p className="text-sm text-ink mt-1">
          {row.statement.object.definition.description['en-US']}
        </p>
      )}
      {(row.evidence_url || evidencePaths.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 mt-1" onClick={(e) => e.stopPropagation()}>
          {row.evidence_url && (
            <a
              href={row.evidence_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-moss font-medium"
            >
              Evidence link
            </a>
          )}
          {evidencePaths.map((path, i) => (
            <EvidenceAttachmentLink key={path} path={path} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
