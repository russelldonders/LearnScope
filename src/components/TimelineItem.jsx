import { formatMonthYear } from '../lib/dates'
import { EXPERIENCE_TYPE_LABELS } from '../lib/experienceTypes'
import OrganizationLogo from './OrganizationLogo'
import ChildExperienceEntry from './ChildExperienceEntry'

export default function TimelineItem({ item, summary, childExperiences, onEdit, isLast }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={`w-3 h-3 rounded-full mt-1.5 ${
            item.type === 'education' ? 'bg-gold' : 'bg-moss'
          }`}
        />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onEdit(item)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onEdit(item)
          }
        }}
        className="text-left bg-card border border-hairline rounded-lg p-4 mb-6 hover:border-moss transition-colors w-full cursor-pointer"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
            {EXPERIENCE_TYPE_LABELS[item.type] ?? item.type}
          </span>
        </div>
        <h3 className="font-display text-lg text-ink">{item.title}</h3>
        {item.organization && (
          <div className="flex items-center gap-2 mt-0.5">
            {item.organization_url && <OrganizationLogo organizationUrl={item.organization_url} size={20} />}
            <p className="text-sm text-secondary">{item.organization}</p>
          </div>
        )}
        <p className="font-mono text-xs text-secondary mt-2">
          {formatMonthYear(item.start_date)} – {item.end_date ? formatMonthYear(item.end_date) : 'Present'}
        </p>
        {item.description && (
          <p className="text-sm text-ink mt-2 whitespace-pre-line">{item.description}</p>
        )}
        {childExperiences?.length > 0 && (
          <div className="mt-3 pt-3 border-t border-hairline">
            {childExperiences.map((c, i) => (
              <ChildExperienceEntry key={c.id} child={c} isLast={i === childExperiences.length - 1} />
            ))}
          </div>
        )}
        {summary && (summary.courseNames.length > 0 || summary.skillNames.length > 0) && (
          <div className="mt-3 pt-3 border-t border-hairline space-y-1">
            {summary.courseNames.length > 0 && (
              <p className="text-xs text-secondary">
                <span className="font-mono uppercase tracking-wide">Courses:</span>{' '}
                {summary.courseNames.join(', ')}
              </p>
            )}
            {summary.skillNames.length > 0 && (
              <p className="text-xs text-secondary">
                <span className="font-mono uppercase tracking-wide">Skills developed:</span>{' '}
                {summary.skillNames.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
