import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import SkillGoalEntryForm from './SkillGoalEntryForm'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabaseClient'
import { formatFullDate } from '../lib/dates'
import { displayLocale } from '../lib/activityTimeline'
import {
  MINI_HISTORY_LENGTH,
  OVER_TARGET_COLOR,
  computeGoalProgress,
  formatGoalValue,
  formatNumber,
  goalLogFeedback,
  goalMiniHistory,
  goalShapeText,
  goalStreak,
  lastGoalEntry,
  localDateString,
} from '../lib/skillGoalProgress'
import { logGoalEntry } from '../lib/skillGoals'

const COLLAPSED_COUNT = 4

// The learner's active goals on the dashboard, so progress can be logged
// without first finding the skill. Items arrive already sorted by what needs
// attention; each carries its goal, skill, activities, progress and next log
// date. Editing goals, charts and correcting entries stay on the skill's page.
export default function SkillGoalsDashboardPanel({
  items,
  collapsedCount = COLLAPSED_COUNT,
  user,
  openGoalId,
  onOpenGoal,
  onChanged,
  headingId = 'dashboard-goals-heading',
  title,
  subtitle,
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [actorName, setActorName] = useState('')

  useEffect(() => {
    let active = true
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (active) setActorName(data?.full_name ?? '')
      })
    return () => {
      active = false
    }
  }, [user.id])

  const openIndex = items.findIndex((item) => item.goal.id === openGoalId)
  const showAll = expanded || openIndex >= collapsedCount
  const visible = showAll ? items : items.slice(0, collapsedCount)

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="font-display text-xl text-ink mb-1">
        {title ?? t('skillGoals.dashboard.title')}
      </h2>
      <p className="text-sm text-secondary mb-6">{subtitle ?? t('skillGoals.dashboard.subtitle')}</p>
      {/* items-start: a tile opened for logging grows on its own, without
          stretching the tile next to it. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        {visible.map((item) => (
          <GoalCard
            key={item.goal.id}
            item={item}
            user={user}
            actor={{ name: actorName, email: user.email }}
            open={item.goal.id === openGoalId}
            onToggle={() => onOpenGoal(item.goal.id === openGoalId ? null : item.goal.id)}
            onChanged={onChanged}
          />
        ))}
      </div>
      {items.length > collapsedCount && openIndex < collapsedCount && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 text-sm text-moss font-medium hover:underline"
        >
          {expanded ? t('skillGoals.dashboard.showFewer') : t('skillGoals.dashboard.showAll', { count: items.length })}
        </button>
      )}
    </section>
  )
}

// The one line under the chart: what was just saved, else the most
// encouraging true thing (a streak, the target reached), else when it was last
// logged. A streak comes before "Target reached" because on a repeating goal
// it already says this period's target was met.
function statusFor({ note, progress, streak, goal, t }) {
  if (note) return { text: t(note), tone: 'text-moss', role: 'status' }
  // A run of one is just "this week was met", so only from two.
  if (streak >= 2) return { text: t(`skillGoals.streak.${goal.period}`, { count: streak }), tone: 'text-moss font-medium' }
  if (progress.reached) return { text: t('skillGoals.targetReached'), tone: 'text-moss font-medium' }
  if (progress.lastLogged) {
    return { text: t('skillGoals.lastLogged', { date: formatFullDate(progress.lastLogged.toISOString()) }), tone: 'text-secondary' }
  }
  return { text: t('skillGoals.dashboard.nothingLogged'), tone: 'text-secondary' }
}

// A missed period with little or nothing logged would be a sliver too thin to
// see, so its red bar is never shorter than this.
const MISSED_MIN_HEIGHT = 15

const BAR_TONES = {
  met: 'bg-moss',
  exceeded: 'bg-moss',
  missed: 'bg-red-700/70',
  inProgress: 'border border-dashed border-b-0 border-moss',
  none: 'bg-hairline/60',
}

function periodLabel(bar, period, locale, t) {
  if (bar.current) return period === 'day' ? t('skillGoals.thisPeriod.day') : t('skillGoals.dashboard.now')
  const options = {
    day: { weekday: 'short' },
    week: { day: 'numeric', month: 'numeric' },
    month: { month: 'short' },
    year: { year: 'numeric' },
  }[period]
  return new Intl.DateTimeFormat(locale, options).format(bar.start)
}

// Seven slots, oldest on the left. A goal begun recently, or with few
// entries, leaves the earliest slots empty so bars keep the same width. A
// period logged more than once is stacked from its entries, a thin line
// between each, and pointing at (or tapping) a bar says what made it up.
function MiniHistory({ goal, history }) {
  const { t, language } = useLanguage()
  const locale = displayLocale(language)
  const [active, setActive] = useState(null)
  const isRepeating = history.kind === 'periods'
  const { bars, target } = history
  // A goal with sets charts its last few days even when it repeats weekly.
  const barPeriod = history.period ?? goal.period
  const max = Math.max(target ?? 0, ...bars.map((bar) => Math.max(bar.value, bar.target ?? 0)), 0)
  // Period totals build up from nothing, so their bars start at zero. Single
  // readings (a weight, a best time) don't: 101 kg against a 96 kg target
  // would be two near-full bars with the line on top of them. Their scale
  // starts a little below the lowest of the readings and the target instead.
  const values = [...bars.map((bar) => bar.value), ...(target != null ? [target] : [])]
  const low = values.length ? Math.min(...values) : 0
  const span = max - low
  const floor = isRepeating ? 0 : Math.max(0, span > 0 ? low - span * 0.35 : low * 0.9)
  const scale = (value) => (max > floor ? ((value - floor) / (max - floor)) * 100 : 0)
  const slots = [...Array(MINI_HISTORY_LENGTH - bars.length).fill(null), ...bars]
  const heightOf = (bar) => {
    const height = Math.max(2, scale(bar.value))
    return bar.status === 'missed' ? Math.max(MISSED_MIN_HEIGHT, height) : height
  }
  const toneOf = (bar) => (bar.status === 'met' && bar.exceeded ? 'exceeded' : bar.status)
  // A bar past its target is green up to the target and lighter above it.
  const backgroundOf = (bar) => {
    const barTarget = bar.target ?? target
    if (!isRepeating || toneOf(bar) !== 'exceeded' || barTarget == null || bar.value <= 0) return undefined
    const split = Math.min(100, (Math.max(0, barTarget) / bar.value) * 100)
    return `linear-gradient(to top, var(--color-moss) ${split}%, ${OVER_TARGET_COLOR} ${split}%)`
  }
  const partText = (value) => (goal.measure_kind === 'duration' ? formatGoalValue(goal, value) : formatNumber(value))
  const describe = (bar) => {
    const when = isRepeating
      ? periodLabel(bar, barPeriod, locale, t)
      : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(bar.start)
    const outcomeKey = bar.status === 'met' || bar.status === 'missed' ? toneOf(bar) : null
    const outcome = outcomeKey ? ` (${t(`skillGoals.dashboard.${outcomeKey}`)})` : ''
    const amount = bar.parts?.length > 1
      ? t('skillGoals.dashboard.fromEntries', {
          value: formatGoalValue(goal, bar.value),
          count: bar.parts.length,
          parts: bar.parts.map(partText).join(' + '),
        })
      : formatGoalValue(goal, bar.value)
    return `${when} ${amount}${outcome}`
  }
  const label = bars.length
    ? `${t('skillGoals.dashboard.history')}: ${bars.map(describe).join(', ')}`
    : t('skillGoals.dashboard.history')
  const activeBar = active != null ? slots[active] : null
  // Kept inside the tile: anchored to the edge on the bar's side, and
  // centred only on the middle bar.
  const middle = (MINI_HISTORY_LENGTH - 1) / 2
  const tipPosition = active < middle
    ? { left: 0 }
    : active > middle
      ? { right: 0 }
      : { left: '50%', transform: 'translateX(-50%)' }

  return (
    <div role="img" aria-label={label}>
      <div
        className={`relative flex items-end gap-1 ${isRepeating ? 'h-10' : 'h-8'}`}
        onMouseLeave={() => setActive(null)}
      >
        {target != null && max > 0 && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-dashed border-secondary/60"
            style={{ bottom: `${scale(target)}%` }}
          />
        )}
        {slots.map((bar, index) => (
          <span
            key={bar ? bar.start.getTime() : `empty-${index}`}
            onMouseEnter={bar ? () => setActive(index) : undefined}
            onClick={bar ? () => setActive((value) => (value === index ? null : index)) : undefined}
            className={`flex-1 flex flex-col-reverse overflow-hidden rounded-t-sm ${
              !bar
                ? ''
                : isRepeating
                  ? BAR_TONES[toneOf(bar)]
                  : bar.current
                    ? 'bg-moss'
                    : 'bg-hairline/60'
            } ${bar ? 'cursor-default' : ''} ${active === index ? 'opacity-80' : ''}`}
            style={{ height: bar ? `${heightOf(bar)}%` : 0, background: bar ? backgroundOf(bar) : undefined }}
          >
            {bar?.parts?.length > 1 && bar.parts.map((part, partIndex) => (
              <span
                key={partIndex}
                data-part=""
                className={`block min-h-px ${
                  partIndex > 0 ? `border-b ${bar.status === 'inProgress' ? 'border-moss/60' : 'border-card'}` : ''
                }`}
                style={{ flexGrow: part, flexBasis: 0 }}
              />
            ))}
          </span>
        ))}
        {activeBar && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-full mb-1 z-10 w-max max-w-full rounded-md bg-ink px-2 py-1 text-[11px] leading-4 text-paper shadow"
            style={tipPosition}
          >
            {describe(activeBar)}
          </span>
        )}
      </div>
      {isRepeating && (
        <div aria-hidden="true" className="mt-1 flex gap-1 text-[11px] leading-4 text-secondary">
          {slots.map((bar, index) => (
            <span key={bar ? bar.start.getTime() : `empty-${index}`} className="flex-1 text-center truncate">
              {bar ? periodLabel(bar, barPeriod, locale, t) : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// A goal heading for one value -- a weight, a best time -- as a line through
// its recent entries, a dot on each, with the target dashed. The line says
// how it's trending, so it takes the place of a progress bar. Entries sit in
// the same seven slots as the bars, latest on the right.
function MiniTrend({ goal, points, target }) {
  const { t, language } = useLanguage()
  const locale = displayLocale(language)
  if (points.length === 0) return null
  const values = [...points.map((p) => p.value), ...(target != null ? [target] : [])]
  const max = Math.max(...values)
  const low = Math.min(...values)
  const span = max - low
  const floor = Math.max(0, span > 0 ? low - span * 0.35 : low * 0.9)
  const ceiling = max > floor ? max : floor + 1
  const y = (value) => ((value - floor) / (ceiling - floor)) * 100
  const slot = 100 / MINI_HISTORY_LENGTH
  const offset = MINI_HISTORY_LENGTH - points.length
  const x = (point, index) => (offset + index + 0.5) * slot
  const coords = points.map((point, index) => ({ point, left: x(point, index), bottom: y(point.value) }))
  const describe = (point) =>
    `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(point.date)} ${formatGoalValue(goal, point.value)}`
  // The target line says what it is: "96 kg by 02/02/27", or just "96 kg".
  const targetText = target == null
    ? null
    : goal.target_date
      ? t('skillGoals.dashboard.targetBy', {
          value: formatGoalValue(goal, target),
          date: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: '2-digit' })
            .format(new Date(`${goal.target_date}T00:00:00`)),
        })
      : formatGoalValue(goal, target)
  const targetAt = target != null ? y(target) : null
  const label = [
    `${t('skillGoals.dashboard.history')}: ${points.map(describe).join(', ')}`,
    targetText ? `${t('skillGoals.targetShort')} ${targetText}` : null,
  ].filter(Boolean).join('. ')
  return (
    <div role="img" aria-label={label} className="relative h-14">
      {target != null && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-dashed border-secondary/60"
            style={{ bottom: `${targetAt}%` }}
          />
          {/* Above the line, or below it when the line is near the top. */}
          <span
            aria-hidden="true"
            data-target-label=""
            className={`absolute z-10 left-0 max-w-full truncate bg-card pr-1 text-[10px] leading-3 text-secondary ${
              targetAt > 70 ? 'pt-0.5' : 'pb-0.5'
            }`}
            style={targetAt > 70 ? { top: `${100 - targetAt}%` } : { bottom: `${targetAt}%` }}
          >
            {targetText}
          </span>
        </>
      )}
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible text-moss">
        <polyline
          points={coords.map((c) => `${c.left},${100 - c.bottom}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {coords.map((c, index) => (
        <span
          key={`${c.point.date.getTime()}-${index}`}
          data-dot=""
          title={describe(c.point)}
          className="absolute w-1.5 h-1.5 -ml-[3px] -mb-[3px] rounded-full bg-moss"
          style={{ left: `${c.left}%`, bottom: `${c.bottom}%` }}
        />
      ))}
    </div>
  )
}

// "31 Dec", with the year only when it isn't this year.
function shortDate(dateString, locale) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const options = { day: 'numeric', month: 'short' }
  if (year !== new Date().getFullYear()) options.year = 'numeric'
  return new Intl.DateTimeFormat(locale, options).format(date)
}

// One bar filling towards the target, with how much is left under it and by
// when.
function BuildUpProgress({ goal, progress }) {
  const { t, language } = useLanguage()
  const locale = displayLocale(language)
  const percent = progress.percent ?? 0
  const left = Math.max(0, Number(goal.target_value) - (progress.current ?? 0))
  const percentText = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
    .format(percent / 100)
  const leftText = formatGoalValue(goal, left)
  const toGo = goal.target_date
    ? t('skillGoals.dashboard.toGoBy', { value: leftText, date: shortDate(goal.target_date, locale) })
    : t('skillGoals.dashboard.toGo', { value: leftText })
  return (
    <div>
      <div
        role="progressbar"
        aria-label={t('skillGoals.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="h-2.5 rounded-full bg-hairline/60 overflow-hidden"
      >
        <div className="h-full rounded-full bg-moss" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1.5 flex justify-between gap-2 text-xs text-secondary">
        <span>{percentText}</span>
        {left > 0 && <span className="truncate">{toGo}</span>}
      </p>
    </div>
  )
}

// Every tile has the same parts in the same places -- title, skill, current
// value against the target, progress bar, one status line, buttons -- so the
// grid reads evenly whatever kind of goal each one is.
function GoalCard({ item, user, actor, open, onToggle, onChanged }) {
  const { t, language } = useLanguage()
  const { goal, skill, statements, progress, nextLog } = item
  const [note, setNote] = useState(null)
  const [prefill, setPrefill] = useState(false)
  const cardRef = useRef(null)
  const today = localDateString()
  const lastEntry = lastGoalEntry(goal, statements)
  const streak = goalStreak(goal, statements)
  const history = goalMiniHistory(goal, statements)
  const due = nextLog != null && nextLog <= today
  const formId = `dashboard-goal-form-${goal.id}`
  const currentLabelKey = goal.aggregation === 'best'
    ? 'skillGoals.bestSoFar'
    : goal.period
      ? `skillGoals.thisPeriod.${goal.period}`
      : 'skillGoals.totalSoFar'
  const status = statusFor({ note, progress, streak, goal, t })
  const shapeText = progress.sessions ? goalShapeText(goal, progress.sessions, t) : null
  // Sessions lead for a goal done in sets across a week or month; a daily one
  // has a single session, so today's total says more.
  const showSessions = shapeText && goal.period !== 'day'
  const targetText = [
    shapeText
      ? `${t('skillGoals.targetShort')} ${shapeText.target}`
      : goal.target_value != null ? `${t('skillGoals.targetShort')} ${formatGoalValue(goal, goal.target_value)}` : null,
    goal.target_date ? `${t('skillGoals.byShort')} ${shortDate(goal.target_date, displayLocale(language))}` : null,
  ].filter(Boolean).join(' · ')

  // Opened from a reminder: bring the card into view and move focus to it.
  useEffect(() => {
    if (!open || !cardRef.current) return
    if (cardRef.current.contains(document.activeElement)) return
    cardRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    cardRef.current.focus({ preventScroll: true })
  }, [open])

  async function handleLog(values) {
    setNote(null)
    const before = progress
    try {
      await logGoalEntry({
        goal,
        skill,
        userId: user.id,
        actor,
        input: values.input,
        date: values.date,
        note: values.note,
        activityTitle: values.activityTitle,
        evidence: values.evidence,
      })
    } catch (err) {
      // The activity is saved before its files upload, so it may exist even
      // though this failed. Reloading shows it, so a retry isn't a duplicate.
      await onChanged()
      throw err
    }
    const refreshed = await onChanged()
    const updated = refreshed?.find((other) => other.goal.id === goal.id)
    const after = updated ? computeGoalProgress(goal, updated.statements) : before
    setNote(
      values.date < goal.started_on
        ? 'skillGoals.savedBeforeStart'
        : goalLogFeedback(goal, before, after) ?? 'skillGoals.saved',
    )
    onToggle()
  }

  function startLogging(withLastValues) {
    setNote(null)
    setPrefill(withLastValues)
    onToggle()
  }

  return (
    <article
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby={`dashboard-goal-${goal.id}`}
      className={`flex flex-col rounded-lg border bg-card p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss ${
        open ? 'border-moss' : 'border-hairline'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* The title and skill together open the skill's page: one bigger tap
            target, and one link for screen readers rather than two. */}
        <Link to={`/skills/${skill.id}`} className="group block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss">
          {/* Always two lines tall, so long and short titles line up. */}
          <h3
            id={`dashboard-goal-${goal.id}`}
            className="text-sm font-medium text-ink line-clamp-2 min-h-[2.5rem] group-hover:text-moss group-hover:underline underline-offset-2"
            title={goal.title}
          >
            {goal.title}
          </h3>
          <span className="block text-xs text-secondary group-hover:text-moss truncate">{skill.name}</span>
        </Link>
        {due && (
          <span className="shrink-0 rounded-full bg-gold/15 text-gold text-[11px] font-medium px-2 py-0.5">
            {t('skillGoals.dashboard.timeToLog')}
          </span>
        )}
      </div>

      <dl className="mt-3 min-w-0">
        <dt className="text-xs text-secondary">{t(currentLabelKey)}</dt>
        <dd className="font-display text-2xl leading-tight text-ink truncate">
          {showSessions ? shapeText.done : progress.current != null ? formatGoalValue(goal, progress.current) : '–'}
        </dd>
      </dl>

      {/* Two lines under the value on every tile, used or not, so tiles are
          the same height side by side and their charts line up: the target
          (or a way to add one), then today's sets for a goal done in sets. */}
      <div className="mt-1 h-8 text-xs leading-4 text-secondary">
        {goal.target_value == null ? (
          // Without a target nothing can be met or missed, so the bars stay
          // grey. Say so, and offer the way to add one.
          <p className="truncate">
            {t('skillGoals.dashboard.noTarget')}{' · '}
            <Link
              to={`/skills/${skill.id}`}
              state={{ editGoalId: goal.id }}
              className="text-moss font-medium hover:underline underline-offset-2"
            >
              {t('skillGoals.dashboard.addTarget')}
            </Link>
          </p>
        ) : (
          <p className="truncate" title={targetText}>{targetText}</p>
        )}
        {shapeText && <p className="truncate" title={shapeText.today}>{shapeText.today}</p>}
      </div>

      {/* A fixed height whatever the goal, so tiles stay level. A total
          filling up to one target shows how full it is as a progress bar;
          a goal heading for one value shows its trend; a repeating goal,
          its recent periods as bars. */}
      <div className="mt-3 h-16 flex flex-col justify-end">
        {history.kind === 'progress' ? (
          <BuildUpProgress goal={goal} progress={progress} />
        ) : history.kind === 'entries' ? (
          <MiniTrend
            goal={goal}
            points={history.bars.map((bar) => ({ date: bar.start, value: bar.value }))}
            target={history.target}
          />
        ) : (
          <MiniHistory goal={goal} history={history} />
        )}
      </div>

      <p role={status.role} className={`mt-2 text-xs truncate ${status.tone}`}>{status.text}</p>

      {open ? (
        <div id={formId} className="mt-3 pt-3 border-t border-hairline">
          <p className="text-sm text-ink mb-2">{goal.tracker_question}</p>
          <SkillGoalEntryForm
            key={prefill ? 'prefilled' : 'empty'}
            goal={goal}
            statements={statements}
            prefillFrom={prefill ? lastEntry : null}
            idPrefix={`dashboard-goal-${goal.id}`}
            submitLabel={t('skillGoals.save')}
            onSubmit={handleLog}
            onCancel={onToggle}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => startLogging(false)}
            // The same border as "Same as last time", invisible, so a tile with
            // only this button is as tall as one with both.
            className="rounded-md border border-transparent bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
          >
            {t('skillGoals.dashboard.logButton')}
          </button>
          {lastEntry && (
            <button
              type="button"
              onClick={() => startLogging(true)}
              className="rounded-md border border-hairline text-ink text-xs font-medium px-3 py-1.5 hover:border-moss"
            >
              {t('skillGoals.dashboard.sameAsLast')}
            </button>
          )}
        </div>
      )}
    </article>
  )
}
