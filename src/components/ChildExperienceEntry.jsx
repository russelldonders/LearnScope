import { Link } from 'react-router-dom'
import { formatDateRange } from '../lib/dates'
import { experienceTypeLabel, formatStudyDuration } from '../lib/experienceTypes'

// A single sub-experience (including a subject nested under education),
// rendered as one row of a mini dot-timeline. Used both on
// the experience detail page's own timeline and nested inside the parent's
// card on the main experience list.
// Subjects and projects are the two kinds of children an education entry
// can have -- the dot color plus type label keep them visually distinct
// from each other in the same list, rather than relying on title alone.
const CHILD_DOT_CLASS = {
  subject: 'bg-gold',
  project: 'bg-slate',
}

export default function ChildExperienceEntry({ child, isLast, onNavigate }) {
  return (
    <div className="flex gap-3 print:break-inside-avoid">
      <div className="flex flex-col items-center w-12 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${CHILD_DOT_CLASS[child.type] ?? 'bg-secondary/40'}`} />
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
            {experienceTypeLabel(child)}
          </span>
          {(formatStudyDuration(child) || child.start_date) && (
            <span className="shrink-0">{formatStudyDuration(child) || formatDateRange(child.start_date, child.end_date)}</span>
          )}
        </p>
      </Link>
    </div>
  )
}
