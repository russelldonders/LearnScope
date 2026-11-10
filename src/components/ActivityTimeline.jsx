import { useState } from 'react'
import ActivityRow from './ActivityRow'
import ActivityReflection from './ActivityReflection'
import { combinedSetRow, dayGroups, dayLabel, displayLocale, foldTimeline } from '../lib/activityTimeline'
import { formatMinutes } from '../lib/xapiStatement'
import { REFLECTION_PROMPTS, canRepeatRow } from '../lib/quickActivityLog'
import { useLanguage } from '../context/LanguageContext'

const ACTION_CLASS = 'text-xs font-medium text-moss hover:underline'

function Dot({ muted = false }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute -left-[23px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-paper ${muted ? 'bg-hairline' : 'bg-moss'}`}
    />
  )
}

function ActivityItem({ row, now, onOpen, onLogAgain, onReflected, dot = true }) {
  const { t } = useLanguage()
  const [prompt, setPrompt] = useState(null)
  const repeatable = onLogAgain && canRepeatRow(row)

  return (
    <li className="relative group">
      {dot && <Dot />}
      <ActivityRow
        row={row}
        framed={false}
        now={now}
        onClick={onOpen ? () => onOpen(row) : undefined}
        actions={(
          // On the verb's line, so showing them on hover doesn't move anything;
          // always shown on touch screens, which can't hover.
          <span
            className={`inline-flex flex-wrap gap-x-3 ${prompt
              ? ''
              : 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 transition-opacity'}`}
          >
            {repeatable && (
              <button type="button" onClick={() => onLogAgain(row)} className={ACTION_CLASS}>
                {t('activity.timeline.logAgain')}
              </button>
            )}
            <button
              type="button"
              aria-expanded={Boolean(prompt)}
              onClick={() => setPrompt(prompt ? null : REFLECTION_PROMPTS[Math.floor(Math.random() * REFLECTION_PROMPTS.length)])}
              className={ACTION_CLASS}
            >
              {prompt ? t('activity.timeline.closeReflection') : t('activity.timeline.reflect')}
            </button>
          </span>
        )}
      >
        {prompt && (
          <ActivityReflection
            rows={[row]}
            promptKey={prompt}
            idPrefix={`timeline-reflection-${row.id}`}
            onSaved={onReflected}
            onClose={() => setPrompt(null)}
          />
        )}
      </ActivityRow>
    </li>
  )
}

// Sets of the same thing on one day (three sets of push-ups) as one line with
// their total and how it was made up, opening to show each set with its own
// actions. The sets stay separate activities; only the timeline joins them.
function SetsItem({ rows, now, onOpen, onLogAgain, onReflected }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const { row, parts, ordered } = combinedSetRow(rows)
  // Sets are counted, so each part is a plain number.
  const partText = parts.map((part) => String(Math.round(part * 100) / 100)).join(' + ')
  return (
    <li className="relative">
      <Dot />
      <ActivityRow
        row={row}
        framed={false}
        now={now}
        actions={(
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={ACTION_CLASS}>
            {t('activity.timeline.sets', { count: rows.length })} {open ? '▴' : '▾'}
          </button>
        )}
      >
        <p className="text-xs text-secondary mt-1">{partText}</p>
        {open && (
          <ol className="mt-3 ml-1 pl-4 border-l border-hairline/50 space-y-3">
            {[...ordered].reverse().map((set) => (
              <ActivityItem key={set.id} row={set} now={now} onOpen={onOpen} onLogAgain={onLogAgain} onReflected={onReflected} dot={false} />
            ))}
          </ol>
        )}
      </ActivityRow>
    </li>
  )
}

function CheckInsItem({ rows }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <li className="relative">
      <Dot muted />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-xs text-secondary hover:text-ink"
      >
        {t('activity.timeline.checkIns', { count: rows.length })} {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => <li key={row.id}><ActivityRow row={row} framed={false} /></li>)}
        </ul>
      )}
    </li>
  )
}

// The learner's recent activity day by day, newest first, along a line with a
// dot per activity. Each day says how much was done; check-ins the app
// recorded stay compact so what the learner actually did leads.
// allRows: everything the shown rows were picked from, so each day's total
// counts the whole day rather than only what's on screen.
export default function ActivityTimeline({ rows, allRows = rows, now = Date.now(), groupBy = 'recorded_at', onOpen, onLogAgain, onReflected }) {
  const { t, language } = useLanguage()

  return (
    <ol className="space-y-6">
      {dayGroups(rows, groupBy, allRows).map((group) => {
        const label = dayLabel(group.date, { now, language: displayLocale(language), t })
        const total = [
          group.activityCount > 0
            ? t(group.activityCount === 1 ? 'activity.timeline.oneActivity' : 'activity.timeline.activities', { count: group.activityCount })
            : null,
          formatMinutes(group.minutes),
        ].filter(Boolean).join(' · ')
        return (
          <li key={group.date}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-secondary mb-3">
              {label}
              {total && <>{' · '}<span className="normal-case tracking-normal font-normal">{total}</span></>}
            </h3>
            <ol className="relative ml-1.5 pl-5 border-l border-hairline/50 space-y-4">
              {foldTimeline(group.rows).map((item) => {
                if (item.type === 'sets') {
                  return (
                    <SetsItem
                      key={`sets-${item.rows[0].id}`}
                      rows={item.rows}
                      now={now}
                      onOpen={onOpen}
                      onLogAgain={onLogAgain}
                      onReflected={onReflected}
                    />
                  )
                }
                if (item.type === 'checkIns') return <CheckInsItem key={item.rows[0].id} rows={item.rows} />
                if (item.type === 'checkIn') {
                  return (
                    <li key={item.row.id} className="relative">
                      <Dot muted />
                      <ActivityRow row={item.row} framed={false} />
                    </li>
                  )
                }
                return (
                  <ActivityItem
                    key={item.row.id}
                    row={item.row}
                    now={now}
                    onOpen={onOpen}
                    onLogAgain={onLogAgain}
                    onReflected={onReflected}
                  />
                )
              })}
            </ol>
          </li>
        )
      })}
    </ol>
  )
}
