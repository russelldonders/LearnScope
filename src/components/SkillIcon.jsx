// Falls back to a generated visual when a skill has no uploaded icon
// (20260909100000's skill_library.icon_url) -- same deterministic,
// free/instant reasoning as CourseThumbnail.jsx (no image-generation API
// call for something that's shown everywhere a skill name appears).
const GRADIENT_PAIRS = [
  ['#4a6741', '#3d5a73'], // moss -> slate
  ['#b8912a', '#4a6741'], // gold -> moss
  ['#3d5a73', '#8fb885'], // slate -> evidence green
  ['#8fb885', '#b8912a'], // evidence green -> gold
  ['#4a6741', '#b8912a'], // moss -> gold
  ['#3d5a73', '#b8912a'], // slate -> gold
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8 rounded-md text-sm',
  md: 'w-12 h-12 rounded-lg text-lg',
  lg: 'w-20 h-20 rounded-xl text-3xl',
}

export default function SkillIcon({ name, iconUrl, size = 'md', className = '' }) {
  const [from, to] = GRADIENT_PAIRS[hashString(name ?? '') % GRADIENT_PAIRS.length]
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
