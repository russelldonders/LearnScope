// Small glyphs for each skill lifecycle stage, matched to what's happening
// at that stage (see src/lib/skillLifecycle.js for the label wording).
const PATHS = {
  identified: (
    // Flag: marking the starting point
    <>
      <line x1="5" y1="21" x2="5" y2="4" />
      <path d="M5 4h13l-2.5 4L18 12H5" />
    </>
  ),
  confirming_baseline: (
    // Question mark in a circle: checking what's actually known
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.7" />
      <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
    </>
  ),
  baseline_assessed: (
    // Target: setting a goal to aim for
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </>
  ),
  target_set: (
    // Trending up: actively growing
    <>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </>
  ),
  developing: (
    // Eye: showing the skill in action
    <>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  demonstrated: (
    // Check-in-circle: confirmed by others
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8 12.5 11 15.5 16 9" />
    </>
  ),
  validated: (
    // Refresh cycle: kept current on an ongoing basis
    <>
      <path d="M20 11a8 8 0 00-14.9-3M4 13a8 8 0 0014.9 3" />
      <polyline points="4 4 4 8 8 8" />
      <polyline points="20 20 20 16 16 16" />
    </>
  ),
  at_risk: (
    <>
      <path d="M12 3L2 20h20L12 3z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </>
  ),
  archived: (
    <>
      <rect x="3" y="4" width="18" height="4" />
      <path d="M5 8v10a1 1 0 001 1h12a1 1 0 001-1V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </>
  ),
}
// validated and maintained share the "Maintaining" label -- share the icon too.
PATHS.maintained = PATHS.validated

export default function LifecycleStageIcon({ stage, size = 12, className = '' }) {
  const glyph = PATHS[stage]
  if (!glyph) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {glyph}
    </svg>
  )
}
