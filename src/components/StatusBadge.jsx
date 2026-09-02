// Shared status/type pill markup for the platform-admin and provider-admin
// consoles (/admin, /provider) -- consolidates the font-mono/uppercase/
// rounded-full pill previously hand-rolled independently in AdminUsers.jsx,
// AdminProviders.jsx, AdminSkills.jsx, AdminTags.jsx, AdminUserDetail.jsx and
// AdminSkillDetail.jsx (same class string, copy-pasted rather than shared).
// Purely presentational: each call site still decides which `tone` applies
// to its own value -- the underlying predicate genuinely differs per entity
// (accountStatus === 'blocked' vs is_blacklisted vs status === 'inactive'),
// so only the resulting CSS is centralized here, not the domain logic.
const TONE_CLASSES = {
  neutral: 'border-hairline text-secondary',
  danger: 'border-red-300 text-red-700',
}

// size 'sm' (default) matches the list-table pills, which set their own
// fixed 10px size. size 'inherit' matches the detail-page chips (
// AdminUserDetail.jsx, AdminSkillDetail.jsx), which sit inside a
// `text-xs` wrapper and were never given their own font-size -- passing
// 'inherit' preserves that slightly larger look rather than shrinking them.
export default function StatusBadge({ label, tone = 'neutral', size = 'sm', className = '' }) {
  const sizeClass = size === 'sm' ? 'text-[10px]' : ''
  return (
    <span
      className={`font-mono ${sizeClass} uppercase tracking-wide rounded-full px-2 py-0.5 border whitespace-nowrap ${
        TONE_CLASSES[tone] ?? TONE_CLASSES.neutral
      } ${className}`}
    >
      {label}
    </span>
  )
}
