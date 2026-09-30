import { gradientPairFor } from '../lib/placeholderGradient'

// Falls back to a generated visual when a skill has no uploaded icon
// (20260909100000's skill_library.icon_url) -- same deterministic,
// free/instant reasoning as CourseThumbnail.jsx (no image-generation API
// call for something that's shown everywhere a skill name appears).
const SIZE_CLASSES = {
  sm: 'w-8 h-8 rounded-md text-sm',
  md: 'w-12 h-12 rounded-lg text-lg',
  lg: 'w-20 h-20 rounded-xl text-3xl',
}

export default function SkillIcon({ name, iconUrl, size = 'md', className = '' }) {
  const [from, to] = gradientPairFor(name)
  const initial = name?.trim()?.[0]?.toUpperCase() ?? '?'
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md

  return (
    <div
      aria-hidden="true"
      className={`relative shrink-0 flex items-center justify-center overflow-hidden ${sizeClass} ${className}`}
      style={iconUrl ? undefined : { background: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="font-display text-paper/90">{initial}</span>
      )}
    </div>
  )
}
