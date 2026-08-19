import { KNOWLEDGE_LEVEL_LABELS } from '../lib/levels'

const SEGMENTS = [1, 2, 3, 4, 5]

// Horizontal fill bar for the knowledge axis -- deliberately not a
// GrowthRing so knowledge reads as visually distinct from practical level
// at a glance, even before any knowledge level has been set.
export default function KnowledgeLevelBar({
  level,
  width = 64,
  height = 10,
  labels = KNOWLEDGE_LEVEL_LABELS,
  color = 'var(--color-slate)',
}) {
  const clampedLevel = Math.min(5, Math.max(0, level ?? 0))
  const label = level ? labels[level] : 'Not yet self-assessed'

  return (
    <div className="flex items-center gap-[3px]" style={{ width }} role="img" aria-label={label}>
      {SEGMENTS.map((n) => (
        <span
          key={n}
          className="rounded-sm flex-1"
          style={{
            height,
            backgroundColor: n <= clampedLevel ? color : 'var(--color-hairline)',
          }}
        />
      ))}
    </div>
  )
}
