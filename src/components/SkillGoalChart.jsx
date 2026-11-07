import { formatFullDate } from '../lib/dates'
import { formatGoalValue } from '../lib/skillGoalProgress'
import { useLanguage } from '../context/LanguageContext'

const WIDTH = 320
const HEIGHT = 96
const PAD_X = 8
const PAD_Y = 10

// A small hand-drawn line so the app takes on no charting dependency. Every
// value is also listed in the goal's entries, which is the accessible
// alternative to reading the chart itself.
export default function SkillGoalChart({ goal, points, target }) {
  const { t } = useLanguage()
  if (points.length < 2) return null

  const values = points.map((p) => p.value)
  if (target != null) values.push(target)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const times = points.map((p) => p.date.getTime())
  const start = Math.min(...times)
  const span = Math.max(...times) - start || 1

  const x = (time) => PAD_X + ((time - start) / span) * (WIDTH - PAD_X * 2)
  const y = (value) => HEIGHT - PAD_Y - ((value - min) / range) * (HEIGHT - PAD_Y * 2)
  const line = points.map((p) => `${x(p.date.getTime())},${y(p.value)}`).join(' ')
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-24 text-moss"
        role="img"
        aria-label={t('skillGoals.chartLabel', {
          count: points.length,
          first: formatGoalValue(goal, first.value),
          last: formatGoalValue(goal, last.value),
        })}
      >
        {target != null && (
          <line
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={y(target)}
            y2={y(target)}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, index) => (
          <circle key={`${p.date.getTime()}-${index}`} cx={x(p.date.getTime())} cy={y(p.value)} r="2.5" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="flex justify-between gap-2 font-mono text-[10px] text-secondary">
        <span>{formatFullDate(first.date.toISOString())} · {formatGoalValue(goal, first.value)}</span>
        <span className="text-right">{formatFullDate(last.date.toISOString())} · {formatGoalValue(goal, last.value)}</span>
      </figcaption>
    </figure>
  )
}
