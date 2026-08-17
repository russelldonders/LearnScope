import { Link } from 'react-router-dom'
import { formatMonthYear } from '../lib/dates'
import { EXPERIENCE_TYPE_LABELS } from '../lib/experienceTypes'

// A single sub-experience (project/course/other nested under a job or
// volunteer role), rendered as one row of a mini dot-timeline. Used both on
// the experience detail page's own timeline and nested inside the parent's
// card on the main experience list.
export default function ChildExperienceEntry({ child, isLast, onNavigate }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-12 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary/40 shrink-0 mt-1.5" />
        {!isLast && <span className="w-px flex-1 bg-hairline mt-1" />}
      </div>
      <Link
        to={`/experience/${child.id}`}
        onClick={(e) => {
          e.stopPropagation()
          onNavigate?.()
        }}
        className="min-w-0 flex-1 mb-3 flex items-center gap-2 text-xs text-secondary hover:text-ink transition-colors"
      >
        <span className="font-mono text-[10px] uppercase tracking-wide shrink-0">
          {EXPERIENCE_TYPE_LABELS[child.type] ?? child.type}
        </span>
        <span className="truncate text-ink">{child.title}</span>
        <span className="font-mono text-[10px] text-secondary/70 shrink-0">
          {formatMonthYear(child.start_date)}
          {child.end_date ? ` – ${formatMonthYear(child.end_date)}` : ''}
        </span>
      </Link>
    </div>
  )
}
