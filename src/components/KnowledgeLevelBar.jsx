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
  // Splits the bar in two: segments up to milestoneLevel render in
  // milestoneColor, the rest (milestoneLevel..level) in `color` -- e.g. the
  // confirmed portion of a level a later self-assessment has since claimed
  // higher than, so "verified" and "claimed since" read as visually
  // distinct rather than one flat colour overstating the higher number.
  milestoneLevel = null,
  milestoneColor = 'var(--color-moss)',
}) {
  const clampedLevel = Math.min(5, Math.max(0, level ?? 0))
  const clampedMilestone = milestoneLevel ? Math.min(5, Math.max(0, milestoneLevel)) : 0
  const label = level ? labels[level] : 'Not yet self-assessed'
  const fullLabel =
    clampedMilestone > 0 && clampedMilestone < clampedLevel
      ? `${label} -- confirmed to ${labels[milestoneLevel]}`
      : label

  return (
    <div className="flex items-center gap-[3px]" style={{ height: size }} role="img" aria-label={fullLabel}>
      {SEGMENTS.map((n) => (
        <span
          key={n}
          className="w-[3px] rounded-full"
          style={{
            height: size,
            backgroundColor:
              n > clampedLevel ? 'var(--color-hairline)' : n <= clampedMilestone ? milestoneColor : color,
          }}
        />
      ))}
    </div>
  )
}
