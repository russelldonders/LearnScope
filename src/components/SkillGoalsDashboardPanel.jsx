import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import SkillGoalEntryForm from './SkillGoalEntryForm'
import { useLanguage } from '../context/LanguageContext'
import { supabase } from '../lib/supabaseClient'
import { formatFullDate } from '../lib/dates'
import { computeGoalProgress, formatGoalValue, goalLogFeedback, goalStreak, lastGoalEntry, localDateString } from '../lib/skillGoalProgress'
import { logGoalEntry } from '../lib/skillGoals'

const COLLAPSED_COUNT = 4

// The learner's active goals on the dashboard, so progress can be logged
// without first finding the skill. Items arrive already sorted by what needs
// attention; each carries its goal, skill, activities, progress and next log
// date. Editing goals, charts and correcting entries stay on the skill's page.
export default function SkillGoalsDashboardPanel({ items, user, openGoalId, onOpenGoal, onChanged }) {
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
  const showAll = expanded || openIndex >= COLLAPSED_COUNT
  const visible = showAll ? items : items.slice(0, COLLAPSED_COUNT)

  return (
    <section aria-labelledby="dashboard-goals-heading">
      <h2 id="dashboard-goals-heading" className="font-display text-xl text-ink mb-1">
        {t('skillGoals.dashboard.title')}
      </h2>
      <p className="text-sm text-secondary mb-6">{t('skillGoals.dashboard.subtitle')}</p>
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
      {items.length > COLLAPSED_COUNT && openIndex < COLLAPSED_COUNT && (
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

// The one line under the progress bar: what was just saved, else the most
// encouraging true thing (target reached, a streak), else when it was last
// logged.
function statusFor({ note, progress, streak, goal, t }) {
  if (note) return { text: t(note), tone: 'text-moss', role: 'status' }
  if (progress.reached) return { text: t('skillGoals.targetReached'), tone: 'text-moss font-medium' }
  // A run of one is just "this week was met", so only from two.
  if (streak >= 2) return { text: t(`skillGoals.streak.${goal.period}`, { count: streak }), tone: 'text-secondary' }
  if (progress.lastLogged) {
    return { text: t('skillGoals.lastLogged', { date: formatFullDate(progress.lastLogged.toISOString()) }), tone: 'text-secondary' }
  }
  return { text: t('skillGoals.dashboard.nothingLogged'), tone: 'text-secondary' }
}

// Every tile has the same parts in the same places -- title, skill, current
// value against the target, progress bar, one status line, buttons -- so the
// grid reads evenly whatever kind of goal each one is.
function GoalCard({ item, user, actor, open, onToggle, onChanged }) {
  const { t } = useLanguage()
  const { goal, skill, statements, progress, nextLog } = item
  const [note, setNote] = useState(null)
  const [prefill, setPrefill] = useState(false)
  const cardRef = useRef(null)
  const today = localDateString()
  const lastEntry = lastGoalEntry(goal, statements)
  const streak = goalStreak(goal, statements)
  const due = nextLog != null && nextLog <= today
  const formId = `dashboard-goal-form-${goal.id}`
  const currentLabelKey = goal.aggregation === 'best'
    ? 'skillGoals.bestSoFar'
    : goal.period
      ? `skillGoals.thisPeriod.${goal.period}`
      : 'skillGoals.totalSoFar'
  const status = statusFor({ note, progress, streak, goal, t })
  const targetText = [
    goal.target_value != null ? `${t('skillGoals.targetShort')} ${formatGoalValue(goal, goal.target_value)}` : null,
    goal.target_date ? `${t('skillGoals.byShort')} ${formatFullDate(goal.target_date)}` : null,
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
        <div className="min-w-0">
          {/* Always two lines tall, so long and short titles line up. */}
          <h3 id={`dashboard-goal-${goal.id}`} className="text-sm font-medium text-ink line-clamp-2 min-h-[2.5rem]" title={goal.title}>
            {goal.title}
          </h3>
          <Link to={`/skills/${skill.id}`} className="block text-xs text-secondary hover:text-moss underline-offset-2 hover:underline truncate">
            {skill.name}
          </Link>
        </div>
        {due && (
          <span className="shrink-0 rounded-full bg-gold/15 text-gold text-[11px] font-medium px-2 py-0.5">
            {t('skillGoals.dashboard.timeToLog')}
          </span>
        )}
      </div>

      <dl className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <dt className="text-xs text-secondary">{t(currentLabelKey)}</dt>
          <dd className="font-display text-2xl leading-tight text-ink truncate">
            {progress.current != null ? formatGoalValue(goal, progress.current) : '–'}
          </dd>
        </div>
        {targetText && (
          <div className="min-w-0 text-right">
            <dt className="sr-only">{t('skillGoals.targetShort')}</dt>
            <dd className="text-xs text-secondary truncate">{targetText}</dd>
          </div>
        )}
      </dl>

      {/* The bar's space is kept even without a target, so tiles stay level. */}
      {progress.percent != null ? (
        <div
          role="progressbar"
          aria-label={t('skillGoals.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.percent)}
          className="mt-2 h-1.5 rounded-full bg-hairline/60 overflow-hidden"
        >
          <div className="h-full bg-moss" style={{ width: `${progress.percent}%` }} />
        </div>
      ) : (
        <div aria-hidden="true" className="mt-2 h-1.5" />
      )}

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
            className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
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
