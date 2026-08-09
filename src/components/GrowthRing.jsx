import { LEVEL_LABELS } from '../lib/levels'

const RADII = [8, 15, 22, 29, 36]

export default function GrowthRing({ level, size = 64, showLabel = false }) {
  const clampedLevel = Math.min(5, Math.max(0, level ?? 0))
  const label = level ? LEVEL_LABELS[level] : 'Not yet self-assessed'

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label}>
        {RADII.map((r, i) => {
          const ringNumber = i + 1
          const filled = ringNumber <= clampedLevel
          return (
            <circle
              key={r}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={filled ? 'var(--color-gold)' : 'var(--color-hairline)'}
              strokeWidth={filled ? 2.5 : 1.5}
            />
          )
        })}
        <circle cx="50" cy="50" r="3" fill={clampedLevel > 0 ? 'var(--color-gold)' : 'var(--color-hairline)'} />
      </svg>
      {showLabel && <span className="font-mono text-xs text-secondary">{label}</span>}
    </div>
  )
}
