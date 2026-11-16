import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import AppHeader from '../components/AppHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import PlanProgressBar from '../components/PlanProgressBar'
import SetTargetModal from '../components/SetTargetModal'
import SkillGoalModal from '../components/SkillGoalModal'
import EvidenceFields from '../components/EvidenceFields'
import { localDateString } from '../lib/skillGoalProgress'
import { ResourceForm } from '../components/SkillResourcesSection'
import { listConnections } from '../lib/connections'
import { addResource } from '../lib/skillResources'
import { PlanDetailsForm } from './Plans'
import {
  addItem,
  addSection,
  deletePlan,
  deleteSection,
  activityHasLearnerContent,
  getActorName,
  getItemActivity,
  getPlan,
  listPlannableRecords,
  loadPlanContext,
  removeItem,
  savePositions,
  setItemDone,
  setPlanStatus,
  startPlan,
  updateItem,
  updatePlan,
  updateSection,
} from '../lib/learnerPlans'
import { currentGoal, paceOf, planItemStatus, summariseProgress, timeElapsedPercent } from '../lib/planProgress'
import { LEVEL_LABELS } from '../lib/levels'
import { formatFullDate } from '../lib/dates'

const ITEM_TYPES = ['course', 'skill', 'skill_goal', 'skill_resource', 'step']

const STATE_TONES = {
  done: 'bg-moss/15 text-moss',
  in_progress: 'bg-gold/15 text-gold',
  not_started: 'border border-hairline text-secondary',
  needs_target: 'border border-gold/50 text-gold',
  stopped: 'border border-hairline text-secondary',
  removed: 'border border-hairline text-secondary',
}

// A learner's plan: its sections in order, each with its items, every item's
// state worked out from the record it points at (planProgress.js).
//
// Two modes, kept apart so working through a plan never risks changing it:
//   use  -- follow progress, tick off steps and resources, set a missing
//           skill target. Nothing about the plan's structure can change.
//   edit -- add, remove, reorder and edit items and sections, and the
//           plan's details. Opened with ?mode=edit; a plan still being
//           prepared (status planning) is always in edit mode, until the
//           learner makes it ready to use.
export default function PlanDetail() {
  const { planId } = useParams()
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [plan, setPlan] = useState(null)
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)
  const [addingTo, setAddingTo] = useState(null)
  const [addingSection, setAddingSection] = useState(false)
  const [editingItemId, setEditingItemId] = useState(null)
  const [editingSectionId, setEditingSectionId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [targetFor, setTargetFor] = useState(null)
  // Who the activities recorded by ticking are by (xAPI actor).
  const [actorName, setActorName] = useState('')

  useEffect(() => {
    getActorName(user.id).then(setActorName).catch(() => {})
  }, [user.id])

  const load = useCallback(async () => {
    const loaded = await getPlan(planId)
    if (!loaded) {
      setNotFound(true)
      return
    }
    setPlan(loaded)
    setContext(await loadPlanContext(user.id, loaded.items))
  }, [planId, user.id])

  useEffect(() => {
    load()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [load])

  async function run(action) {
    setError(null)
    setBusy(true)
    try {
      await action()
      await load()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const statusById = useMemo(() => {
    if (!plan || !context) return new Map()
    return new Map(plan.items.map((item) => [item.id, planItemStatus(item, context)]))
  }, [plan, context])

  if (loading) {
    return <Shell><p className="text-secondary">{t('plans.loading')}</p></Shell>
  }
  if (notFound || !plan) {
    return (
      <Shell>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-secondary">{t('plans.notFound')}</p>}
        <Link to="/plans" className="mt-3 inline-block text-sm text-moss font-medium hover:underline">{t('plans.backToPlans')}</Link>
      </Shell>
    )
  }

  const planning = plan.status === 'planning'
  // Where a page opened from this plan should lead back to: here, in the same
  // mode. Course pages read backTo/backLabel, skill pages from/fromLabel.
  const here = `/plans/${plan.id}${searchParams.toString() ? `?${searchParams}` : ''}`
  const backState = { backTo: here, backLabel: plan.title, from: here, fromLabel: plan.title }
  const editing = planning || searchParams.get('mode') === 'edit'
  const progress = summariseProgress([...statusById.values()])
  const elapsed = timeElapsedPercent(plan, context?.today)
  const pace = plan.status === 'active' ? paceOf(progress, elapsed) : null

  function setEditing(on) {
    setAddingTo(null)
    setAddingSection(false)
    setEditingItemId(null)
    setEditingSectionId(null)
    setEditingDetails(false)
    setSearchParams(on ? { mode: 'edit' } : {}, { replace: true })
  }

  async function makeReady() {
    const ok = await run(() => startPlan(plan))
    if (ok) setEditing(false)
  }
  const groups = [
    { section: null, items: plan.items.filter((item) => !item.section_id) },
    ...plan.sections.map((section) => ({ section, items: plan.items.filter((item) => item.section_id === section.id) })),
  ]

  async function move(list, index, delta, table) {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const reordered = [...list]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    await run(() => savePositions(table, reordered.map((row, position) => ({ id: row.id, position }))))
  }

  return (
    <Shell>
      <Link to="/plans" className="text-sm text-moss font-medium hover:underline">{t('plans.backToPlans')}</Link>

      {editing && (
        <div data-mode="edit" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{planning ? t('plans.planningBannerTitle') : t('plans.editBannerTitle')}</p>
            <p className="text-xs text-secondary">{planning ? t('plans.planningBannerHint') : t('plans.editBannerHint')}</p>
          </div>
          {planning ? (
            <button type="button" disabled={busy || plan.items.length === 0} onClick={makeReady} className="shrink-0 rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60">
              {t('plans.readyToUse')}
            </button>
          ) : (
            <button type="button" onClick={() => setEditing(false)} className="shrink-0 rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90">
              {t('plans.doneEditing')}
            </button>
          )}
        </div>
      )}

      {editingDetails ? (
        <div className="mt-4 rounded-lg border border-hairline bg-card p-4">
          <PlanDetailsForm
            plan={plan}
            submitLabel={t('plans.saveChanges')}
            onCancel={() => setEditingDetails(false)}
            onSubmit={async (values) => {
              await updatePlan(plan.id, values)
              setEditingDetails(false)
              await load()
            }}
          />
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-3xl text-ink break-words">{plan.title}</h1>
              <p className="mt-1 text-sm text-secondary">
                {plan.starts_on && plan.target_on
                  ? t('plans.timeframe', { start: formatFullDate(plan.starts_on), end: formatFullDate(plan.target_on) })
                  : plan.target_on
                    ? t('plans.byDate', { date: formatFullDate(plan.target_on) })
                    : t('plans.noEndDate')}
                {plan.status !== 'active' && ` · ${t(`plans.status.${plan.status}`)}`}
                {plan.status === 'completed' && plan.completed_on && ` ${formatFullDate(plan.completed_on)}`}
              </p>
            </div>
            {editing ? (
              <button type="button" onClick={() => setEditingDetails(true)} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss">
                {t('plans.editDetails')}
              </button>
            ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} className="rounded-md bg-moss text-paper px-3 py-1.5 text-xs font-medium hover:opacity-90">
                {t('plans.editPlan')}
              </button>
              {plan.status === 'active' ? (
                <button type="button" disabled={busy} onClick={() => run(() => setPlanStatus(plan.id, 'completed'))} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss disabled:opacity-60">
                  {t('plans.markComplete')}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => run(() => setPlanStatus(plan.id, 'active'))} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss disabled:opacity-60">
                  {t('plans.reopen')}
                </button>
              )}
              {plan.status !== 'archived' && (
                <button type="button" disabled={busy} onClick={() => run(() => setPlanStatus(plan.id, 'archived'))} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-secondary hover:text-ink disabled:opacity-60">
                  {t('plans.archive')}
                </button>
              )}
            </div>
            )}
          </div>
          {plan.description && <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words max-w-2xl">{plan.description}</p>}
        </div>
      )}

      {!editing && (
      <section aria-label={t('plans.progressHeading')} className="mt-6 rounded-lg border border-hairline bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-ink">
            <span className="font-display text-2xl">{progress.percent}%</span>{' '}
            <span className="text-secondary">{t('plans.doneCount', { done: progress.done, total: progress.total })}</span>
          </p>
          {pace && (
            <span data-pace={pace} className={`rounded-full px-2 py-0.5 text-xs font-medium ${pace === 'behind' ? 'bg-red-700/15 text-red-700' : pace === 'ahead' ? 'bg-moss/15 text-moss' : 'bg-gold/15 text-gold'}`}>
              {t(`plans.pace.${pace}`)}
            </span>
          )}
        </div>
        <PlanProgressBar className="mt-2" percent={progress.percent} elapsed={elapsed} label={t('plans.progressLabel', { title: plan.title })} />
        <p className="mt-2 text-xs text-secondary">
          {elapsed != null && t('plans.timeElapsed', { percent: elapsed })}
          {elapsed != null && progress.overdue > 0 && ' · '}
          {progress.overdue > 0 && <span className="text-red-700">{t('plans.overdueCount', { count: progress.overdue })}</span>}
        </p>
      </section>
      )}

      {!editing && plan.items.length === 0 && (
        <div className="mt-6 text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">{t('plans.emptyPlan')}</p>
          <button type="button" onClick={() => setEditing(true)} className="mt-3 text-sm text-moss font-medium hover:underline">{t('plans.editPlan')}</button>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      <div className="mt-6 space-y-6">
        {groups.map(({ section, items }, groupIndex) => {
          const sectionProgress = summariseProgress(items.map((item) => statusById.get(item.id) ?? { state: 'not_started' }))
          if (!section && items.length === 0 && (plan.sections.length > 0 || !editing)) return null
          if (section && items.length === 0 && !editing) return null
          const sectionIndex = groupIndex - 1
          return (
            <section key={section?.id ?? 'top'} aria-labelledby={section ? `plan-section-${section.id}` : undefined}>
              {section && (
                editingSectionId === section.id ? (
                  <SectionForm
                    section={section}
                    busy={busy}
                    onCancel={() => setEditingSectionId(null)}
                    onSubmit={async (values) => {
                      const ok = await run(() => updateSection(section.id, values))
                      if (ok) setEditingSectionId(null)
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2">
                    <div className="min-w-0">
                      <h2 id={`plan-section-${section.id}`} className="font-display text-xl text-ink break-words">{section.title}</h2>
                      <p className="text-xs text-secondary">
                        {t('plans.doneCount', { done: sectionProgress.done, total: sectionProgress.total })}
                        {section.target_on && ` · ${t('plans.byDate', { date: formatFullDate(section.target_on) })}`}
                      </p>
                    </div>
                    {editing && (
                    <div className="flex gap-2 text-xs">
                      <IconButton label={t('plans.moveSectionUp', { title: section.title })} disabled={busy || sectionIndex === 0} onClick={() => move(plan.sections, sectionIndex, -1, 'learner_plan_sections')}>↑</IconButton>
                      <IconButton label={t('plans.moveSectionDown', { title: section.title })} disabled={busy || sectionIndex === plan.sections.length - 1} onClick={() => move(plan.sections, sectionIndex, 1, 'learner_plan_sections')}>↓</IconButton>
                      <button type="button" onClick={() => setEditingSectionId(section.id)} className="text-moss font-medium hover:underline">{t('plans.edit')}</button>
                      <button type="button" onClick={() => setConfirm({ kind: 'section', section })} className="text-red-700 font-medium hover:underline">{t('plans.delete')}</button>
                    </div>
                    )}
                  </div>
                )
              )}

              {items.length === 0 && section && editing && <p className="mt-2 text-sm text-secondary">{t('plans.sectionEmpty')}</p>}
              <ul className="mt-2 space-y-2">
                {items.map((item, index) => (
                  <li key={item.id} className="rounded-md border border-hairline bg-card p-3">
                    {editingItemId === item.id ? (
                      <ItemEditForm
                        item={item}
                        sections={plan.sections}
                        busy={busy}
                        onCancel={() => setEditingItemId(null)}
                        onSubmit={async (values) => {
                          const ok = await run(() => updateItem(item.id, values))
                          if (ok) setEditingItemId(null)
                        }}
                      />
                    ) : (
                      <PlanItem
                        item={item}
                        status={statusById.get(item.id)}
                        context={context}
                        busy={busy}
                        editing={editing}
                        backState={backState}
                        canMoveUp={index > 0}
                        canMoveDown={index < items.length - 1}
                        onMoveUp={() => move(items, index, -1, 'learner_plan_items')}
                        onMoveDown={() => move(items, index, 1, 'learner_plan_items')}
                        onComplete={(values) => run(() => setItemDone(item, true, { userId: user.id, actor: { name: actorName, email: user.email }, ...values }))}
                        onUntick={(removeActivity) => run(() => setItemDone(item, false, { userId: user.id, actor: { name: actorName, email: user.email }, removeActivity }))}
                        onLoadActivity={() => getItemActivity(item)}
                        onEdit={() => setEditingItemId(item.id)}
                        onRemove={() => setConfirm({ kind: 'item', item })}
                        onSetTarget={() => setTargetFor(item)}
                      />
                    )}
                  </li>
                ))}
              </ul>

              {!editing ? null : addingTo === (section?.id ?? 'top') ? (
                <AddItemForm
                  userId={user.id}
                  busy={busy}
                  onCancel={() => setAddingTo(null)}
                  onSubmit={async (values) => {
                    const ok = await run(() => addItem(plan.id, { ...values, sectionId: section?.id ?? null, position: items.length }))
                    if (ok) setAddingTo(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTo(section?.id ?? 'top')}
                  className="mt-2 text-sm text-moss font-medium hover:underline"
                >
                  {section ? t('plans.addItemTo', { title: section.title }) : t('plans.addItem')}
                </button>
              )}
            </section>
          )
        })}
      </div>

      {editing && (
      <div className="mt-8 border-t border-hairline pt-4">
        {addingSection ? (
          <SectionForm
            busy={busy}
            onCancel={() => setAddingSection(false)}
            onSubmit={async (values) => {
              const ok = await run(() => addSection(plan.id, { ...values, position: plan.sections.length }))
              if (ok) setAddingSection(false)
            }}
          />
        ) : (
          <button type="button" onClick={() => setAddingSection(true)} className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-ink hover:border-moss">
            {t('plans.addSection')}
          </button>
        )}
        <p className="mt-6">
          <button type="button" onClick={() => setConfirm({ kind: 'plan' })} className="text-sm text-red-700 font-medium hover:underline">
            {t('plans.deletePlan')}
          </button>
        </p>
      </div>
      )}

      {confirm && (
        <ConfirmDialog
          message={
            confirm.kind === 'plan'
              ? t('plans.confirmDeletePlan', { title: plan.title })
              : confirm.kind === 'section'
                ? t('plans.confirmDeleteSection', { title: confirm.section.title })
                : t('plans.confirmRemoveItem')
          }
          confirmLabel={confirm.kind === 'item' ? t('plans.remove') : t('plans.delete')}
          confirming={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm.kind === 'plan') {
              setBusy(true)
              try {
                await deletePlan(plan.id)
                navigate('/plans')
              } catch (err) {
                setError(err.message)
                setBusy(false)
                setConfirm(null)
              }
              return
            }
            await run(() => (confirm.kind === 'section' ? deleteSection(confirm.section.id) : removeItem(confirm.item.id)))
            setConfirm(null)
          }}
        />
      )}

      {targetFor && (
        <SetTargetModal
          skill={targetFor.skills}
          user={user}
          targets={[]}
          currentLevel={targetFor.skills.level}
          onClose={() => setTargetFor(null)}
          onSet={async () => {
            setTargetFor(null)
            await load()
          }}
        />
      )}
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}

function IconButton({ label, disabled, onClick, children }) {
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

// What an item is, where it leads, and the one line that says how it's going.
function describeItem(item, status, context, t) {
  switch (item.item_type) {
    case 'course':
      return { title: item.courses?.name, href: item.courses ? `/courses/${item.courses.id}/learn` : null, detail: item.courses?.provider }
    case 'skill': {
      const skill = item.skills
      const target = skill ? context?.latestTargetBySkill?.get(skill.id) : null
      return {
        title: skill?.name,
        href: skill ? `/skills/${skill.id}` : null,
        detail: skill
          ? target
            ? t('plans.skillLevelOfTarget', { level: LEVEL_LABELS[skill.level] ?? skill.level, target: LEVEL_LABELS[target.target_level] ?? target.target_level })
            : t('plans.skillNoTarget', { level: LEVEL_LABELS[skill.level] ?? skill.level })
          : null,
      }
    }
    case 'skill_goal': {
      const goal = context ? currentGoal(item.skill_goal_id, context.goalsById, context.replacedBy) : null
      const title = goal?.title ?? item.skill_goals?.title
      return { title, href: goal?.skill_id || item.skill_goals?.skill_id ? `/skills/${goal?.skill_id ?? item.skill_goals.skill_id}` : null, detail: null }
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

function PlanItem({ item, status, context, busy, editing, backState = null, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onComplete, onUntick, onLoadActivity, onEdit, onRemove, onSetTarget }) {
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
  const { title, href, external, detail } = describeItem(item, status, context, t)
  // Ticking off is part of working through the plan, so only in use mode.
  const tickable = !editing && (item.item_type === 'step' || (item.item_type === 'skill_resource' && state !== 'removed'))
  const typeLabel = t(`plans.itemTypes.${item.item_type}`)
  const shownTitle = state === 'removed' ? t('plans.removedRecord', { type: typeLabel }) : title
  const stepComplete = state === 'done' || completing
  const statusDotClass = editing
    ? 'border border-hairline'
    : stepComplete
      ? 'bg-moss'
      : state === 'in_progress'
        ? 'bg-gold'
        : 'border border-hairline'

  return (
    <div className="flex gap-3">
      {tickable && item.item_type === 'step' ? (
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
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {href && state !== 'removed' ? (
            external ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-moss hover:underline break-words">{shownTitle}</a>
            ) : (
              <Link to={href} state={backState} className="text-sm font-medium text-moss hover:underline break-words">{shownTitle}</Link>
            )
          ) : (
            <span className={`text-sm font-medium break-words ${state === 'removed' ? 'text-secondary italic' : 'text-ink'} ${state === 'done' && tickable ? 'line-through decoration-secondary' : ''}`}>{shownTitle}</span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{typeLabel}</span>
          {(!editing || state === 'removed') && (
            <span data-state={state} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONES[state]}`}>
              {t(`plans.states.${state}`)}
            </span>
          )}
          {!editing && status?.overdue && <span className="rounded-full bg-red-700/15 text-red-700 px-2 py-0.5 text-[11px] font-medium">{t('plans.overdue')}</span>}
        </div>
        {detail && <p className="mt-0.5 text-xs text-secondary">{detail}</p>}
        {item.target_on && <p className="mt-0.5 text-xs text-secondary">{t('plans.byDate', { date: formatFullDate(item.target_on) })}</p>}
        {item.note && <p className="mt-1 text-sm text-secondary whitespace-pre-wrap break-words">{item.note}</p>}
        {!editing && state === 'done' && item.completion_statement_id && (
          <p className="mt-0.5 text-xs text-secondary">
            {t('plans.loggedActivity')}{' '}
            <Link to="/activity" className="text-moss font-medium hover:underline">{t('plans.viewActivityLog')}</Link>
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
        {!editing && state === 'needs_target' && (
          <div className="mt-2 text-xs">
            <button type="button" onClick={onSetTarget} className="text-gold font-medium hover:underline">{t('plans.setTarget')}</button>
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
  )
}

const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-moss'

// Marking a step done: when (today, or an earlier day), what happened, and
// anything that shows it -- recorded on the activity the tick creates.
function CompleteStepForm({ busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const today = localDateString()
  const [completedOn, setCompletedOn] = useState(today)
  const [comment, setComment] = useState('')
  const [showEvidence, setShowEvidence] = useState(false)
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [files, setFiles] = useState([])
  const [error, setError] = useState(null)
  const idPrefix = `complete-step-${useId()}`

  return (
    <form
      noValidate
      aria-label={t('plans.completeStepTitle')}
      className="mt-2 space-y-3 rounded-md border border-hairline bg-paper p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!completedOn || completedOn > today) return setError(t('plans.errorFutureDate'))
        setError(null)
        onSubmit({ completedOn, comment, evidence: { evidenceUrl, files } })
      }}
    >
      <p className="text-sm font-medium text-ink">{t('plans.completeStepTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div>
          <label htmlFor={`${idPrefix}-date`} className="text-xs text-secondary">{t('plans.completedOnLabel')}</label>
          <input id={`${idPrefix}-date`} type="date" max={today} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-comment`} className="text-xs text-secondary">{t('plans.commentLabel')}</label>
          <textarea id={`${idPrefix}-comment`} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('plans.commentPlaceholder')} className={inputClass} />
        </div>
      </div>
      {showEvidence ? (
        <EvidenceFields
          evidenceUrl={evidenceUrl}
          onEvidenceUrlChange={setEvidenceUrl}
          files={files}
          onFilesChange={setFiles}
          onHide={() => setShowEvidence(false)}
        />
      ) : (
        <button type="button" onClick={() => setShowEvidence(true)} className="text-xs text-moss font-medium hover:underline">
          {t('plans.addEvidence')}
        </button>
      )}
      <p className="text-xs text-secondary">{t('plans.activityHint')}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">
          {busy ? t('plans.saving') : t('plans.markDoneButton')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
      </div>
    </form>
  )
}

function SectionForm({ section = null, busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(section?.title ?? '')
  const [targetOn, setTargetOn] = useState(section?.target_on ?? '')
  const [error, setError] = useState(null)
  const idPrefix = `section-${section?.id ?? 'new'}`
  return (
    <form
      noValidate
      className="space-y-3 rounded-md border border-hairline bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim()) return setError(t('plans.errorSectionTitle'))
        setError(null)
        onSubmit({ title, targetOn })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={`${idPrefix}-title`} className="text-xs text-secondary">{t('plans.sectionTitleLabel')}</label>
          <input id={`${idPrefix}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t('plans.sectionTitlePlaceholder')} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-target`} className="text-xs text-secondary">{t('plans.sectionTargetLabel')}</label>
          <input id={`${idPrefix}-target`} type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} className={inputClass} />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">
          {section ? t('plans.saveChanges') : t('plans.addSection')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
      </div>
    </form>
  )
}

function recordLabel(type, record, t) {
  switch (type) {
    case 'course': return record.provider ? `${record.name} — ${record.provider}` : record.name
    case 'skill': return record.name
    case 'skill_goal': return record.skill_name ? `${record.title} (${record.skill_name})` : record.title
    case 'skill_resource': return `${record.title} · ${t(`skillDetail.resources.kinds.${record.kind}`)}`
    default: return ''
  }
}

function AddItemForm({ userId, busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const [records, setRecords] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [itemType, setItemType] = useState('course')
  const [recordId, setRecordId] = useState('')
  const [stepTitle, setStepTitle] = useState('')
  const [stepSkillId, setStepSkillId] = useState('')
  const [targetOn, setTargetOn] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  // Making a new goal or resource here, rather than picking an existing one.
  const [creatingGoal, setCreatingGoal] = useState(false)
  const [creatingResource, setCreatingResource] = useState(false)
  const [resourceSkillId, setResourceSkillId] = useState('')
  const [connections, setConnections] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listPlannableRecords(userId).then(setRecords).catch((err) => setLoadError(err.message))
  }, [userId])

  const ensureConnections = useCallback(() => {
    if (connections !== null) return
    listConnections(userId).then(setConnections).catch(() => setConnections([]))
  }, [connections, userId])

  const options = itemType === 'step' ? [] : records?.[itemType] ?? []
  const skills = records?.skill ?? []
  const resourceSkill = skills.find((skill) => skill.id === resourceSkillId) ?? null

  return (
    <>
      {creatingResource ? (
        <div className="mt-2 space-y-3 rounded-md border border-hairline bg-card p-3">
          <p className="text-sm font-medium text-ink">{t('plans.newResourceTitle')}</p>
          <div>
            <label htmlFor="plan-new-resource-skill" className="text-xs text-secondary">{t('plans.newResourceSkill')}</label>
            {skills.length === 0 ? (
              <p className="text-sm text-secondary">{t('plans.noneYet.skill')}</p>
            ) : (
              <select id="plan-new-resource-skill" value={resourceSkillId} onChange={(e) => setResourceSkillId(e.target.value)} className={inputClass}>
                <option value="">{t('plans.choosePrompt')}</option>
                {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
              </select>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {resourceSkill ? (
            <ResourceForm
              key={resourceSkill.id}
              hasLibrarySkill={Boolean(resourceSkill.library_skill_id)}
              connections={connections}
              onNeedConnections={ensureConnections}
              busy={busy || saving}
              submitLabel={t('plans.createAndAdd')}
              onCancel={() => setCreatingResource(false)}
              onSubmit={async (values) => {
                setSaving(true)
                setError(null)
                try {
                  const id = await addResource({ userId, skillId: resourceSkill.id, ...values })
                  await onSubmit({ itemType: 'skill_resource', recordId: id, targetOn, note })
                } catch (err) {
                  setError(err.message)
                } finally {
                  setSaving(false)
                }
              }}
            />
          ) : (
            <button type="button" onClick={() => setCreatingResource(false)} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
          )}
        </div>
      ) : (
        <form
          noValidate
          className="mt-2 space-y-3 rounded-md border border-hairline bg-card p-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (itemType === 'step' ? !stepTitle.trim() : !recordId) return setError(t(itemType === 'step' ? 'plans.errorStepTitle' : 'plans.errorChooseRecord'))
            setError(null)
            onSubmit({ itemType, recordId, stepTitle, stepSkillId, targetOn, note })
          }}
        >
          <fieldset>
            <legend className="text-xs text-secondary">{t('plans.itemTypeLabel')}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {ITEM_TYPES.map((type) => (
                <label key={type} className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium ${itemType === type ? 'border-moss text-moss' : 'border-hairline text-ink'}`}>
                  <input type="radio" name="plan-item-type" value={type} checked={itemType === type} onChange={() => { setItemType(type); setRecordId(''); setError(null) }} className="sr-only" />
                  {t(`plans.itemTypes.${type}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {itemType === 'step' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="plan-item-step" className="text-xs text-secondary">{t('plans.stepLabel')}</label>
                <input id="plan-item-step" value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} maxLength={200} placeholder={t('plans.stepPlaceholder')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="plan-item-step-skill" className="text-xs text-secondary">{t('plans.stepSkillLabel')}</label>
                <select id="plan-item-step-skill" value={stepSkillId} onChange={(e) => setStepSkillId(e.target.value)} className={inputClass}>
                  <option value="">{t('plans.noSkill')}</option>
                  {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="plan-item-record" className="text-xs text-secondary">{t(`plans.choose.${itemType}`)}</label>
              {loadError ? (
                <p role="alert" className="text-sm text-red-700">{loadError}</p>
              ) : records === null ? (
                <p className="text-sm text-secondary">{t('plans.loading')}</p>
              ) : options.length === 0 ? (
                <p className="text-sm text-secondary">{t(`plans.noneYet.${itemType}`)}</p>
              ) : (
                <select id="plan-item-record" value={recordId} onChange={(e) => setRecordId(e.target.value)} className={inputClass}>
                  <option value="">{t('plans.choosePrompt')}</option>
                  {options.map((record) => (
                    <option key={record.id} value={record.id}>{recordLabel(itemType, record, t)}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {itemType === 'skill_goal' && (
            <button type="button" onClick={() => setCreatingGoal(true)} className="text-xs text-moss font-medium hover:underline">
              {t('plans.createGoal')}
            </button>
          )}
          {itemType === 'skill_resource' && (
            <button type="button" onClick={() => { setError(null); setCreatingResource(true) }} className="text-xs text-moss font-medium hover:underline">
              {t('plans.createResource')}
            </button>
          )}
          {(itemType === 'step' || itemType === 'skill_resource') && (
            <p className="text-xs text-secondary">{t('plans.activityHint')}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="plan-item-target" className="text-xs text-secondary">{t('plans.itemTargetLabel')}</label>
              <input id="plan-item-target" type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="plan-item-note" className="text-xs text-secondary">{t('plans.noteLabel')}</label>
              <input id="plan-item-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={inputClass} />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">{t('plans.addToPlan')}</button>
            <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
          </div>
        </form>
      )}

      {/* The same goal dialog as on Home: the learner describes the goal (AI
          drafts it) and picks or names its skill. The new goal goes straight
          into the plan. */}
      {creatingGoal && (
        <SkillGoalModal
          userId={userId}
          onClose={() => setCreatingGoal(false)}
          onSaved={async (created) => {
            setCreatingGoal(false)
            if (created) await onSubmit({ itemType: 'skill_goal', recordId: created.id, targetOn, note })
          }}
        />
      )}
    </>
  )
}

function ItemEditForm({ item, sections, busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const isStep = item.item_type === 'step'
  const [stepTitle, setStepTitle] = useState(item.step_title ?? '')
  const [stepSkillId, setStepSkillId] = useState(item.step_skill_id ?? '')
  const [skills, setSkills] = useState([])
  const [targetOn, setTargetOn] = useState(item.target_on ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [sectionId, setSectionId] = useState(item.section_id ?? '')
  const [error, setError] = useState(null)
  const idPrefix = `plan-item-${item.id}`

  useEffect(() => {
    if (!isStep) return
    listPlannableRecords(user.id).then((records) => setSkills(records.skill)).catch(() => {})
  }, [isStep, user.id])

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (isStep && !stepTitle.trim()) return setError(t('plans.errorStepTitle'))
        setError(null)
        onSubmit({
          targetOn,
          note,
          sectionId,
          stepTitle: isStep ? stepTitle : undefined,
          stepSkillId: isStep ? stepSkillId : undefined,
        })
      }}
    >
      {isStep && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-step`} className="text-xs text-secondary">{t('plans.stepLabel')}</label>
            <input id={`${idPrefix}-step`} value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} maxLength={200} className={inputClass} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-step-skill`} className="text-xs text-secondary">{t('plans.stepSkillLabel')}</label>
            <select id={`${idPrefix}-step-skill`} value={stepSkillId} onChange={(e) => setStepSkillId(e.target.value)} className={inputClass}>
              <option value="">{t('plans.noSkill')}</option>
              {/* The current skill stays listed even before the list loads. */}
              {item.step_skill && !skills.some((s) => s.id === item.step_skill.id) && (
                <option value={item.step_skill.id}>{item.step_skill.name}</option>
              )}
              {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-section`} className="text-xs text-secondary">{t('plans.sectionLabel')}</label>
          <select id={`${idPrefix}-section`} value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={inputClass}>
            <option value="">{t('plans.noSection')}</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-target`} className="text-xs text-secondary">{t('plans.itemTargetLabel')}</label>
          <input id={`${idPrefix}-target`} type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-note`} className="text-xs text-secondary">{t('plans.noteLabel')}</label>
        <textarea id={`${idPrefix}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className={inputClass} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90 disabled:opacity-60">{t('plans.saveChanges')}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs text-secondary hover:text-ink">{t('plans.cancel')}</button>
      </div>
    </form>
  )
}
