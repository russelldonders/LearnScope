import { useState } from 'react'
import ActivityRow, { SkillChip } from './ActivityRow'
import ActivityReflection from './ActivityReflection'
import { combinedSetRow, dayGroups, dayLabel, displayLocale, foldTimeline, packageGroupSummary } from '../lib/activityTimeline'
import { formatMinutes } from '../lib/xapiStatement'
import { formatAbsoluteDate, formatRelativeDate } from '../lib/dates'
import { REFLECTION_PROMPTS, canRepeatRow } from '../lib/quickActivityLog'
import { canEditActivity } from '../lib/activityEdits'
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

// Something earned or passed: a gold star on the line instead of a dot.
export function AchievementMark({ className = '' }) {
  return (
    <span aria-hidden="true" className={`flex items-center justify-center w-4 h-4 rounded-full bg-gold text-paper ring-4 ring-paper text-[9px] leading-none ${className}`}>
      ★
    </span>
  )
}

const OUTCOME_CLASS = {
  passed: 'bg-moss/15 text-moss',
  completed: 'bg-moss/10 text-moss',
  failed: 'bg-hairline/60 text-secondary',
}

// Sessions in one course package (0316) as one entry that leads with what
// was achieved -- stamps and badges earned, passed and how well -- then how
// much was done, opening to show each session. On the timeline it's a day's
// sessions; a skill's History adds the date (dated, for lists without day
// headings); a package resource shows all of the learner's sessions in it
// the same way, under its own title (titled=false, showSkills=false,
// sessionDates, with children shown alongside the sessions when opened).
export function PackageSessions({
  rows,
  dated = false,
  titled = true,
  showSkills = true,
  sessionDates = false,
  onOpen,
  onOpenChange,
  children = null,
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const summary = packageGroupSummary(rows)
  const newest = summary.sessions[0].row
  const outcomeText = summary.outcome
    ? [t(`activity.verbs.${summary.outcome}`), summary.bestScore != null ? `${summary.bestScore}%` : null].filter(Boolean).join(' · ')
    : null
  const amount = [
    summary.sessions.length === 1 ? t('activity.timeline.packageOneSession') : t('activity.timeline.packageSessions', { count: summary.sessions.length }),
    formatMinutes(summary.minutes),
  ].filter(Boolean).join(' · ')
  const achieved = summary.earned.length > 0 || summary.outcome === 'passed' || summary.outcome === 'completed'
  const outcomeBadge = outcomeText && (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_CLASS[summary.outcome]}`}>{outcomeText}</span>
  )
  const workedThrough = !achieved && <p className="text-xs text-secondary mt-0.5">{t('activity.timeline.packageWorkedThrough')}</p>

  function toggle() {
    const next = !open
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div data-package-sessions="">
      {titled ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {onOpen ? (
              <button type="button" onClick={() => onOpen(newest)} className="text-left text-sm font-medium text-ink hover:text-moss hover:underline break-words">
                {summary.title}
              </button>
            ) : (
              <p className="text-sm font-medium text-ink break-words">{summary.title}</p>
            )}
            {workedThrough}
          </div>
          {outcomeBadge}
        </div>
      ) : (
        (outcomeBadge || workedThrough) && <div className="flex flex-wrap items-center gap-2">{outcomeBadge}{workedThrough}</div>
      )}

      {summary.earned.length > 0 && (
        <div className="mt-2">
          <p className="sr-only">{t('activity.timeline.packageEarned')}</p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('activity.timeline.packageEarned')}>
            {summary.earned.map((name) => (
              <li key={name} className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/15 px-2.5 py-0.5 text-xs font-medium text-ink">
                <span aria-hidden="true" className="text-gold">★</span>
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-secondary mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{amount}</span>
        {dated && <span title={formatAbsoluteDate(newest.recorded_at)}>· {formatRelativeDate(newest.recorded_at)}</span>}
        {titled && <span>· {t('activity.timeline.via', { source: t('activity.timeline.packageSource') })}</span>}
        <button type="button" aria-expanded={open} onClick={toggle} className={ACTION_CLASS}>
          {open ? t('activity.timeline.packageHideSessions') : t('activity.timeline.packageShowSessions')} {open ? '▴' : '▾'}
        </button>
      </p>

      {showSkills && summary.skills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {summary.skills.map((skill) => <SkillChip key={skill.id} skill={skill} />)}
        </div>
      )}

      {open && (
        <ol className="mt-3 ml-1 pl-4 border-l border-hairline/50 space-y-1.5">
          {summary.sessions.map((session) => (
            <li key={session.row.id} className="text-xs text-secondary">
              <span className="text-ink tabular-nums">
                {new Date(session.row.recorded_at).toLocaleString(undefined, sessionDates
                  ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
                  : { hour: 'numeric', minute: '2-digit' })}
              </span>
              {[
                formatMinutes(session.minutes),
                session.outcome ? [t(`activity.verbs.${session.outcome}`), session.score != null ? `${session.score}%` : null].filter(Boolean).join(' ') : null,
                session.earned.length ? `★ ${session.earned.join(', ')}` : null,
              ].filter(Boolean).map((part) => ` · ${part}`).join('')}
            </li>
          ))}
        </ol>
      )}
      {open && children}
    </div>
  )
}

function PackageItem({ rows, onOpen }) {
  const summary = packageGroupSummary(rows)
  const achieved = summary.earned.length > 0 || summary.outcome === 'passed' || summary.outcome === 'completed'
  return (
    <li className="relative">
      {achieved ? <AchievementMark className="absolute -left-[26.5px] top-0.5" /> : <Dot />}
      <PackageSessions rows={rows} onOpen={onOpen} />
    </li>
  )
}

function ActivityItem({ row, now, onOpen, onLogAgain, onReflected, onEdit, dot = true }) {
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
            {onEdit && canEditActivity(row) && (
              <button type="button" onClick={() => onEdit(row)} className={ACTION_CLASS}>
                {t('activity.timeline.edit')}
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
// Also used by a skill's History tab, which lists activities among ratings
// and courses rather than under day headings (dated adds the date).
export function ActivitySets({ rows, now = Date.now(), dated = false, onOpen, onLogAgain, onReflected, onEdit }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const { row, parts, ordered } = combinedSetRow(rows)
  // Sets are counted, so each part is a plain number.
  const partText = parts.map((part) => String(Math.round(part * 100) / 100)).join(' + ')
  return (
    <ActivityRow
      row={row}
      framed={false}
      dated={dated}
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
            <ActivityItem key={set.id} row={set} now={now} onOpen={onOpen} onLogAgain={onLogAgain} onReflected={onReflected} onEdit={onEdit} dot={false} />
          ))}
        </ol>
      )}
    </ActivityRow>
  )
}

function SetsItem(props) {
  return (
    <li className="relative">
      <Dot />
      <ActivitySets {...props} />
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
// onEdit(row): change or delete an activity the learner logged themselves.
export default function ActivityTimeline({ rows, allRows = rows, now = Date.now(), groupBy = 'recorded_at', onOpen, onLogAgain, onReflected, onEdit }) {
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
                      onEdit={onEdit}
                    />
                  )
                }
                if (item.type === 'package') {
                  return <PackageItem key={`package-${item.rows[0].id}`} rows={item.rows} onOpen={onOpen} />
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
                    onEdit={onEdit}
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
