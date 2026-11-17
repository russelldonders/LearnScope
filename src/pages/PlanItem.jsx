import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'
import { activityHasLearnerContent } from '../lib/learnerPlans'
import { currentGoal } from '../lib/planProgress'
import { KNOWLEDGE_LEVEL_LABELS, LEVEL_LABELS } from '../lib/levels'
import { formatFullDate } from '../lib/dates'
import { CompleteStepForm } from './PlanItemForms'

// One item on a plan's page, with its reorder controls (see PlanDetail.jsx).

const STATE_TONES = {
  done: 'bg-moss/15 text-moss',
  in_progress: 'bg-gold/15 text-gold',
  not_started: 'border border-hairline text-secondary',
  needs_target: 'border border-gold/50 text-gold',
  stopped: 'border border-hairline text-secondary',
  removed: 'border border-hairline text-secondary',
}

export function IconButton({ label, disabled, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="w-6 h-6 rounded border border-hairline text-secondary hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  )
}

// The grip on the left of an item or section in edit mode: a large target
// that drags by mouse, touch or pen (see dragHandlers), and moves its item
// up or down with the arrow keys once focused.
export function DragHandle({ label, disabled, handlers, onMoveUp, onMoveDown }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      {...handlers}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' && onMoveUp) {
          event.preventDefault()
          onMoveUp()
        } else if (event.key === 'ArrowDown' && onMoveDown) {
          event.preventDefault()
          onMoveDown()
        }
      }}
      className="flex min-h-11 w-10 shrink-0 touch-none select-none items-center justify-center self-stretch rounded-md border border-hairline bg-paper text-secondary transition-colors hover:border-moss hover:bg-moss/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-moss cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
        <circle cx="5.5" cy="3.5" r="1.4" /><circle cx="10.5" cy="3.5" r="1.4" />
        <circle cx="5.5" cy="8" r="1.4" /><circle cx="10.5" cy="8" r="1.4" />
        <circle cx="5.5" cy="12.5" r="1.4" /><circle cx="10.5" cy="12.5" r="1.4" />
      </svg>
    </button>
  )
}

// What an item is, where it leads, and the one line that says how it's going.
// On a shared plan, an item the viewer hasn't added to their records yet has
// no record of theirs: it's named by source_title, and leads nowhere.
function describeItem(item, status, context, t) {
  switch (item.item_type) {
    case 'course':
      return { title: item.courses?.name ?? item.source_title, href: item.courses ? `/courses/${item.courses.id}/learn` : null, detail: item.courses?.provider }
    case 'skill': {
      const skill = item.skills
      const currentLevels = skill ? [
        skill.knowledge_level && t('plans.knowledgeLevelValue', { level: KNOWLEDGE_LEVEL_LABELS[skill.knowledge_level] ?? skill.knowledge_level }),
        skill.level && t('plans.abilityLevelValue', { level: LEVEL_LABELS[skill.level] ?? skill.level }),
      ].filter(Boolean) : []
      const planLevels = [
        item.plan_knowledge_level && t('plans.knowledgeLevelValue', { level: KNOWLEDGE_LEVEL_LABELS[item.plan_knowledge_level] ?? item.plan_knowledge_level }),
        item.plan_practical_level && t('plans.abilityLevelValue', { level: LEVEL_LABELS[item.plan_practical_level] ?? item.plan_practical_level }),
      ].filter(Boolean)
      return {
        title: skill?.name ?? item.source_title,
        href: skill ? `/skills/${skill.id}` : null,
        skillLevels: skill || item.needs_link ? { currentLevels, planLevels } : null,
      }
    }
    case 'skill_goal': {
      const goal = context ? currentGoal(item.skill_goal_id, context.goalsById, context.replacedBy) : null
      const title = goal?.title ?? item.skill_goals?.title ?? item.source_title
      // An active goal opens as its own tile in a pop-up; one that has ended
      // has no tile, so it still leads to its skill's page.
      const goalTileId = goal && context.goalItemsById?.has(goal.id) ? goal.id : null
      const skillId = goal?.skill_id ?? item.skill_goals?.skill_id
      return { title, goalTileId, href: !goalTileId && skillId ? `/skills/${skillId}` : null, detail: null }
    }
    case 'skill_resource':
      return {
        title: item.skill_resources?.title,
        href: item.skill_resources?.url ?? (item.skill_resources ? `/skills/${item.skill_resources.skill_id}` : null),
        external: Boolean(item.skill_resources?.url),
        detail: null,
      }
    default:
      return {
        title: item.step_title,
        href: null,
        detail: item.step_skill ? t('plans.developsSkill', { skill: item.step_skill.name }) : null,
      }
  }
}

export function PlanItem({ item, status, context, busy, editing, backState = null, canMoveUp, canMoveDown, dragHandlers, onMoveUp, onMoveDown, onComplete, onUntick, onLoadActivity, onEdit, onRemove, onOpenGoal }) {
  const { t } = useLanguage()
  const state = status?.state ?? 'not_started'
  // Marking a step done asks for a date, comment and evidence first; a
  // resource is ticked straight away.
  const [completing, setCompleting] = useState(false)
  // Unticking a step whose activity holds the learner's comment or evidence
  // asks what to do with it rather than deciding for them.
  const [untickChoice, setUntickChoice] = useState(false)
  const [checking, setChecking] = useState(false)

  async function handleToggle(checked) {
    if (checked) {
      if (item.item_type === 'step') setCompleting(true)
      else onComplete({})
      return
    }
    setChecking(true)
    try {
      let activity = null
      try {
        activity = await onLoadActivity()
      } catch {
        // Couldn't look: untick the usual way, which only removes an
        // activity it can confirm is untouched, and reports any error.
      }
      if (activityHasLearnerContent(activity)) setUntickChoice(true)
      else await onUntick(undefined)
    } finally {
      setChecking(false)
    }
  }
  const { title, href, external, detail, skillLevels, goalTileId } = describeItem(item, status, context, t)
  // Ticking off is part of working through the plan, so only in use mode.
  const tickable = !editing && (item.item_type === 'step' || (item.item_type === 'skill_resource' && state !== 'removed'))
  const typeLabel = t(`plans.itemTypes.${item.item_type}`)
  const shownTitle = state === 'removed' ? t('plans.removedRecord', { type: typeLabel }) : title
  const stepComplete = state === 'done' || completing
  const stepTileClickable = !editing && item.item_type === 'step' && !completing && !untickChoice
  const statusDotClass = editing
    ? 'border border-hairline'
    : stepComplete
      ? 'bg-moss'
      : state === 'in_progress'
        ? 'bg-gold'
        : 'border border-hairline'

  return (
    <>
      {stepTileClickable && (
        <button
          type="button"
          aria-label={t('plans.markDone', { title: shownTitle })}
          aria-pressed={stepComplete}
          disabled={busy || checking}
          onClick={() => handleToggle(!stepComplete)}
          className="absolute inset-0 rounded-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-wait"
        />
      )}
      <div className={`relative z-10 flex gap-3 ${stepTileClickable ? 'pointer-events-none' : ''}`}>
        {editing ? (
          <DragHandle
            label={t('plans.dragItem', { title: shownTitle })}
            disabled={busy}
            handlers={dragHandlers}
            onMoveUp={canMoveUp ? onMoveUp : null}
            onMoveDown={canMoveDown ? onMoveDown : null}
          />
        ) : stepTileClickable ? (
          <span aria-hidden="true" className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${statusDotClass}`} />
        ) : tickable && item.item_type === 'step' ? (
          <button
            type="button"
            aria-label={t('plans.markDone', { title: shownTitle })}
            aria-pressed={stepComplete}
            disabled={busy || checking || untickChoice}
            onClick={() => handleToggle(!stepComplete)}
            className={`relative mt-1.5 h-3 w-3 shrink-0 rounded-full transition-[background-color,border-color,box-shadow] after:absolute after:-inset-3 after:rounded-full hover:ring-4 hover:ring-moss/15 disabled:cursor-wait disabled:opacity-50 ${statusDotClass}`}
          />
        ) : tickable ? (
          <input
            type="checkbox"
            checked={state === 'done' || completing}
            disabled={busy || checking || untickChoice}
            onChange={(e) => handleToggle(e.target.checked)}
            aria-label={t('plans.markDone', { title: shownTitle })}
            className="mt-1 h-4 w-4 accent-moss shrink-0"
          />
        ) : (
          <span aria-hidden="true" className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${statusDotClass}`} />
        )}
        <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            {goalTileId && state !== 'removed' ? (
              <button type="button" onClick={() => onOpenGoal(goalTileId)} className="text-left text-sm font-medium text-moss hover:underline break-words">{shownTitle}</button>
            ) : href && state !== 'removed' ? (
              external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-moss hover:underline break-words">{shownTitle}</a>
              ) : (
                <Link to={href} state={backState} className="text-sm font-medium text-moss hover:underline break-words">{shownTitle}</Link>
              )
            ) : (
              <span className={`text-sm font-medium break-words ${state === 'removed' ? 'text-secondary italic' : 'text-ink'} ${state === 'done' && tickable ? 'line-through decoration-secondary' : ''}`}>{shownTitle}</span>
            )}
            <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{typeLabel}</span>
            {item.visibility && item.visibility !== 'members' && (
              <span data-visibility={item.visibility} className="rounded-full border border-hairline px-1.5 py-px text-[10px] text-secondary">
                {t(`plans.visibilityBadge.${item.visibility}`)}
              </span>
            )}
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-1.5">
            {(!editing || state === 'removed') && (
              <span data-state={state} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONES[state]}`}>
                {t(`plans.states.${state}`)}
              </span>
            )}
            {!editing && status?.overdue && <span className="rounded-full bg-red-700/15 text-red-700 px-2 py-0.5 text-[11px] font-medium">{t('plans.overdue')}</span>}
          </div>
        </div>
        {detail && <p className="mt-0.5 text-xs text-secondary">{detail}</p>}
        {skillLevels && (
          <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-secondary">{t('plans.planSkillTargetLabel')}</dt>
              <dd className="break-words font-medium text-ink">{skillLevels.planLevels.length ? skillLevels.planLevels.join(' · ') : t('plans.planSkillTargetMissing')}</dd>
            </div>
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-secondary">{t('plans.yourSkillLevelLabel')}</dt>
              <dd className="break-words text-ink">{skillLevels.currentLevels.length ? skillLevels.currentLevels.join(' · ') : t('plans.skillLevelNotSet')}</dd>
            </div>
          </dl>
        )}
        {item.target_on && <p className="mt-0.5 text-xs text-secondary">{t('plans.byDate', { date: formatFullDate(item.target_on) })}</p>}
        {item.note && <p className="mt-1 text-sm text-secondary whitespace-pre-wrap break-words">{item.note}</p>}
        {!editing && state === 'done' && item.completion_statement_id && (
          <p className="mt-0.5 text-xs text-secondary">
            {t('plans.loggedActivity')}{' '}
            <Link to="/activity" className="pointer-events-auto relative z-20 text-moss font-medium hover:underline">{t('plans.viewActivityLog')}</Link>
          </p>
        )}
        {completing && (
          <CompleteStepForm
            busy={busy}
            onCancel={() => setCompleting(false)}
            onSubmit={async (values) => {
              const ok = await onComplete(values)
              if (ok) setCompleting(false)
            }}
          />
        )}
        {untickChoice && (
          <div role="group" aria-label={t('plans.untickTitle')} className="mt-2 rounded-md border border-hairline bg-paper p-3">
            <p className="text-sm text-ink">{t('plans.untickHasContent')}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <button type="button" disabled={busy} onClick={async () => { await onUntick(false); setUntickChoice(false) }} className="rounded-md border border-hairline px-3 py-1.5 font-medium text-ink hover:border-moss disabled:opacity-60">
                {t('plans.untickKeep')}
              </button>
              <button type="button" disabled={busy} onClick={async () => { await onUntick(true); setUntickChoice(false) }} className="rounded-md border border-hairline px-3 py-1.5 font-medium text-red-700 hover:border-red-700 disabled:opacity-60">
                {t('plans.untickRemove')}
              </button>
              <button type="button" disabled={busy} onClick={() => setUntickChoice(false)} className="text-secondary hover:text-ink">
                {t('plans.cancel')}
              </button>
            </div>
          </div>
        )}
        {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button type="button" onClick={onEdit} className="text-moss font-medium hover:underline">{t('plans.edit')}</button>
          <button type="button" onClick={onRemove} className="text-red-700 font-medium hover:underline">{t('plans.remove')}</button>
          <IconButton label={t('plans.moveUp', { title: shownTitle })} disabled={busy || !canMoveUp} onClick={onMoveUp}>↑</IconButton>
          <IconButton label={t('plans.moveDown', { title: shownTitle })} disabled={busy || !canMoveDown} onClick={onMoveDown}>↓</IconButton>
        </div>
        )}
        </div>
      </div>
    </>
  )
}
