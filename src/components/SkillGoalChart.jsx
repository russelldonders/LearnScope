import { formatFullDate } from '../lib/dates'
import { formatGoalValue, goalChartPoints, goalPeriodBars } from '../lib/skillGoalProgress'
import { useLanguage } from '../context/LanguageContext'

const WIDTH = 320
const HEIGHT = 96
const PAD_X = 8
const PAD_Y = 10

// Small hand-drawn charts so the app takes on no charting dependency. Every
// value is also listed in the goal's entries, which is the accessible
// alternative to reading the chart itself. A repeating total (per day, week,
// month or year) gets a bar per period, coloured by whether it met the target;
// anything else gets a line through its values.
export default function SkillGoalChart({ goal, statements, target }) {
  if (goal.aggregation === 'total' && goal.period) {
    return <PeriodBars goal={goal} bars={goalPeriodBars(goal, statements)} target={target} />
  }
  return <ValueLine goal={goal} points={goalChartPoints(goal, statements)} target={target} />
}

function TargetLine({ y }) {
  return (
    <line
      x1={PAD_X}
      x2={WIDTH - PAD_X}
      y1={y}
      y2={y}
      stroke="currentColor"
      className="text-ink"
      strokeOpacity="0.5"
      strokeDasharray="4 4"
      vectorEffect="non-scaling-stroke"
    />
  )
}

const BAR_CLASS = {
  met: 'fill-moss',
  missed: 'fill-gold',
  inProgress: 'fill-moss opacity-40',
  none: 'fill-moss',
}

function PeriodBars({ goal, bars, target }) {
  const { t } = useLanguage()
  // A single period has nothing to compare yet.
  if (bars.length < 2) return null

  const max = Math.max(...bars.map((b) => Math.max(b.value, b.target ?? 0)), target ?? 0) * 1.1 || 1
  const slot = (WIDTH - PAD_X * 2) / bars.length
  const barWidth = Math.max(2, slot * 0.7)
  const y = (value) => HEIGHT - PAD_Y - (value / max) * (HEIGHT - PAD_Y * 2)
  const met = bars.filter((b) => b.status === 'met').length
  const missed = bars.filter((b) => b.status === 'missed').length
  const inProgress = bars.some((b) => b.status === 'inProgress')
  const first = bars[0]
  const last = bars[bars.length - 1]

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="w-full h-24"
        role="img"
        aria-label={
          target != null
            ? t('skillGoals.periodChart.label', { count: bars.length, met, missed })
            : t('skillGoals.periodChart.labelNoTarget', { count: bars.length })
        }
      >
        {bars.map((bar, index) => {
          // A period with nothing logged still shows, as a sliver on the axis.
          const top = Math.min(y(bar.value), HEIGHT - PAD_Y - 1.5)
          return (
            <rect
              key={bar.start.getTime()}
              x={PAD_X + index * slot + (slot - barWidth) / 2}
              y={top}
              width={barWidth}
              height={HEIGHT - PAD_Y - top}
              rx="1"
              className={BAR_CLASS[bar.status]}
            >
              <title>{`${formatFullDate(bar.start.toISOString())} · ${formatGoalValue(goal, bar.value)}`}</title>
            </rect>
          )
        })}
        {target != null && <TargetLine y={y(target)} />}
      </svg>
      <figcaption className="font-mono text-[10px] text-secondary">
        <div className="flex justify-between gap-2">
          <span>{formatFullDate(first.start.toISOString())}</span>
          <span className="text-right">{t(`skillGoals.thisPeriod.${goal.period}`)} · {formatGoalValue(goal, last.value)}</span>
        </div>
        {target != null && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            <LegendItem swatch="bg-moss" label={t('skillGoals.periodChart.met', { count: met })} />
            <LegendItem swatch="bg-gold" label={t('skillGoals.periodChart.missed', { count: missed })} />
            {inProgress && <LegendItem swatch="bg-moss opacity-40" label={t('skillGoals.periodChart.inProgress')} />}
          </ul>
        )}
      </figcaption>
    </figure>
  )
}

function LegendItem({ swatch, label }) {
  return (
    <li className="flex items-center gap-1">
      <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-sm ${swatch}`} />
      {label}
    </li>
  )
}

function ValueLine({ goal, points, target }) {
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
        {target != null && <TargetLine y={y(target)} />}
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
