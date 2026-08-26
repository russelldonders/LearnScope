// Bar-only -- the moss-fill-on-hairline-track look already used by
// CourseLearn.jsx's own progress header, factored out so course tiles and
// the course detail page can reuse it instead of each reimplementing the
// same two divs. Callers render their own "X% complete" / "n/total" text
// around it, since that label's layout differs by context.
export default function ProgressBar({ percent, className = '' }) {
  return (
    <div className={`h-1.5 rounded-full bg-hairline overflow-hidden ${className}`}>
      <div className="h-full bg-moss rounded-full transition-all" style={{ width: `${percent}%` }} />
    </div>
  )
}
