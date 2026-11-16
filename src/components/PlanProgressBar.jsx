// A plan's progress bar, with a thin marker for how much of its timeframe
// has gone (elapsed, 0-100, or null when the plan has no dates), so a glance
// says whether the learner is keeping pace.
export default function PlanProgressBar({ percent, elapsed = null, label, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-3 overflow-hidden rounded-full border border-hairline bg-paper"
      >
        <div className="h-full rounded-full bg-moss transition-all" style={{ width: `${percent}%` }} />
      </div>
      {elapsed != null && elapsed > 0 && elapsed < 100 && (
        <span
          aria-hidden="true"
          data-elapsed=""
          className="absolute -top-1 -bottom-1 w-0.5 rounded bg-ink/60"
          style={{ left: `calc(${elapsed}% - 1px)` }}
        />
      )}
    </div>
  )
}
