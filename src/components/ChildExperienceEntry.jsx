import { Link } from 'react-router-dom'
import { formatDateRange } from '../lib/dates'
import { EXPERIENCE_TYPE_LABELS, formatStudyDuration } from '../lib/experienceTypes'

// A single sub-experience (including a subject nested under education),
// rendered as one row of a mini dot-timeline. Used both on
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
        className="min-w-0 flex-1 mb-3 block hover:text-ink transition-colors"
      >
        <p className="text-sm text-ink break-words">{child.title}</p>
        <p className="flex items-center gap-2 font-mono text-[10px] text-secondary/80 mt-0.5">
          <span className="uppercase tracking-wide shrink-0">
            {EXPERIENCE_TYPE_LABELS[child.type] ?? child.type}
          </span>
          {(formatStudyDuration(child) || child.start_date) && (
            <span className="shrink-0">{formatStudyDuration(child) || formatDateRange(child.start_date, child.end_date)}</span>
          )}
        </p>
      </Link>
    </div>
  )
}
