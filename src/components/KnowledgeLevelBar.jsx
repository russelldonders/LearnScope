import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'

const SEGMENTS = [1, 2, 3, 4, 5]

// Thin dash meter for the knowledge axis -- deliberately not a GrowthRing
// so knowledge reads as visually distinct from practical level at a
// glance, even before any knowledge level has been set. `size` mirrors
// GrowthRing's prop so the two read as a matched pair at the same scale.
export default function KnowledgeLevelBar({
  level,
  size = 40,
  labels = KNOWLEDGE_LEVEL_LABELS,
  color = 'var(--color-slate)',
}) {
  const clampedLevel = Math.min(5, Math.max(0, level ?? 0))
  const label = level ? labels[level] : 'Not yet self-assessed'

  return (
    <div className="flex items-center gap-[3px]" style={{ height: size }} role="img" aria-label={label}>
      {SEGMENTS.map((n) => (
        <span
          key={n}
          className="w-[3px] rounded-full"
          style={{
            height: size,
            backgroundColor: n <= clampedLevel ? color : 'var(--color-hairline)',
          }}
        />
      ))}
    </div>
  )
}
