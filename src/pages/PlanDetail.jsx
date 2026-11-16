import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import AppHeader from '../components/AppHeader'
import ConfirmDialog from '../components/ConfirmDialog'
import PlanProgressBar from '../components/PlanProgressBar'
import SetTargetModal from '../components/SetTargetModal'
import { PlanDetailsForm } from './Plans'
import {
  addItem,
  addSection,
  deletePlan,
  deleteSection,
  getPlan,
  listPlannableRecords,
  loadPlanContext,
  removeItem,
  savePositions,
  setItemDone,
  setPlanStatus,
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
// state worked out from the record it points at (planProgress.js). The
// learner ticks off steps and resources here; everything else moves on as
// the course, skill or goal itself does.
export default function PlanDetail() {
  const { planId } = useParams()
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
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

  const progress = summariseProgress([...statusById.values()])
  const elapsed = timeElapsedPercent(plan, context?.today)
  const pace = plan.status === 'active' ? paceOf(progress, elapsed) : null
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
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditingDetails(true)} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss">
                {t('plans.editDetails')}
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
          </div>
          {plan.description && <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words max-w-2xl">{plan.description}</p>}
        </div>
      )}

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

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      <div className="mt-6 space-y-6">
        {groups.map(({ section, items }, groupIndex) => {
          const sectionProgress = summariseProgress(items.map((item) => statusById.get(item.id) ?? { state: 'not_started' }))
          if (!section && items.length === 0 && plan.sections.length > 0) return null
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
                    <div className="flex gap-2 text-xs">
                      <IconButton label={t('plans.moveSectionUp', { title: section.title })} disabled={busy || sectionIndex === 0} onClick={() => move(plan.sections, sectionIndex, -1, 'learner_plan_sections')}>↑</IconButton>
                      <IconButton label={t('plans.moveSectionDown', { title: section.title })} disabled={busy || sectionIndex === plan.sections.length - 1} onClick={() => move(plan.sections, sectionIndex, 1, 'learner_plan_sections')}>↓</IconButton>
                      <button type="button" onClick={() => setEditingSectionId(section.id)} className="text-moss font-medium hover:underline">{t('plans.edit')}</button>
                      <button type="button" onClick={() => setConfirm({ kind: 'section', section })} className="text-red-700 font-medium hover:underline">{t('plans.delete')}</button>
                    </div>
                  </div>
                )
              )}

              {items.length === 0 && section && <p className="mt-2 text-sm text-secondary">{t('plans.sectionEmpty')}</p>}
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
                        canMoveUp={index > 0}
                        canMoveDown={index < items.length - 1}
                        onMoveUp={() => move(items, index, -1, 'learner_plan_items')}
                        onMoveDown={() => move(items, index, 1, 'learner_plan_items')}
                        onToggleDone={(done) => run(() => setItemDone(item.id, done))}
                        onEdit={() => setEditingItemId(item.id)}
                        onRemove={() => setConfirm({ kind: 'item', item })}
                        onSetTarget={() => setTargetFor(item)}
                      />
                    )}
                  </li>
                ))}
              </ul>

              {addingTo === (section?.id ?? 'top') ? (
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
      return { title: item.courses?.name, href: item.courses ? `/courses/${item.courses.id}` : null, detail: item.courses?.provider }
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
      return { title: item.step_title, href: null, detail: null }
  }
}

function PlanItem({ item, status, context, busy, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onToggleDone, onEdit, onRemove, onSetTarget }) {
  const { t } = useLanguage()
  const state = status?.state ?? 'not_started'
  const { title, href, external, detail } = describeItem(item, status, context, t)
  const tickable = item.item_type === 'step' || (item.item_type === 'skill_resource' && state !== 'removed')
  const typeLabel = t(`plans.itemTypes.${item.item_type}`)
  const shownTitle = state === 'removed' ? t('plans.removedRecord', { type: typeLabel }) : title

  return (
    <div className="flex gap-3">
      {tickable ? (
        <input
          type="checkbox"
          checked={state === 'done'}
          disabled={busy}
          onChange={(e) => onToggleDone(e.target.checked)}
          aria-label={t('plans.markDone', { title: shownTitle })}
          className="mt-1 h-4 w-4 accent-moss shrink-0"
        />
      ) : (
        <span aria-hidden="true" className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${state === 'done' ? 'bg-moss' : state === 'in_progress' ? 'bg-gold' : 'border border-hairline'}`} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {href && state !== 'removed' ? (
            external ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-moss hover:underline break-words">{shownTitle}</a>
            ) : (
              <Link to={href} className="text-sm font-medium text-moss hover:underline break-words">{shownTitle}</Link>
            )
          ) : (
            <span className={`text-sm font-medium break-words ${state === 'removed' ? 'text-secondary italic' : 'text-ink'} ${state === 'done' && tickable ? 'line-through decoration-secondary' : ''}`}>{shownTitle}</span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{typeLabel}</span>
          <span data-state={state} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONES[state]}`}>
            {t(`plans.states.${state}`)}
          </span>
          {status?.overdue && <span className="rounded-full bg-red-700/15 text-red-700 px-2 py-0.5 text-[11px] font-medium">{t('plans.overdue')}</span>}
        </div>
        {detail && <p className="mt-0.5 text-xs text-secondary">{detail}</p>}
        {item.target_on && <p className="mt-0.5 text-xs text-secondary">{t('plans.byDate', { date: formatFullDate(item.target_on) })}</p>}
        {item.note && <p className="mt-1 text-sm text-secondary whitespace-pre-wrap break-words">{item.note}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {state === 'needs_target' && (
            <button type="button" onClick={onSetTarget} className="text-gold font-medium hover:underline">{t('plans.setTarget')}</button>
          )}
          <button type="button" onClick={onEdit} className="text-moss font-medium hover:underline">{t('plans.edit')}</button>
          <button type="button" onClick={onRemove} className="text-red-700 font-medium hover:underline">{t('plans.remove')}</button>
          <IconButton label={t('plans.moveUp', { title: shownTitle })} disabled={busy || !canMoveUp} onClick={onMoveUp}>↑</IconButton>
          <IconButton label={t('plans.moveDown', { title: shownTitle })} disabled={busy || !canMoveDown} onClick={onMoveDown}>↓</IconButton>
        </div>
      </div>
    </div>
  )
}

const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-moss'

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
  const [targetOn, setTargetOn] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    listPlannableRecords(userId).then(setRecords).catch((err) => setLoadError(err.message))
  }, [userId])

  const options = itemType === 'step' ? [] : records?.[itemType] ?? []

  return (
    <form
      noValidate
      className="mt-2 space-y-3 rounded-md border border-hairline bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (itemType === 'step' ? !stepTitle.trim() : !recordId) return setError(t(itemType === 'step' ? 'plans.errorStepTitle' : 'plans.errorChooseRecord'))
        setError(null)
        onSubmit({ itemType, recordId, stepTitle, targetOn, note })
      }}
    >
      <fieldset>
        <legend className="text-xs text-secondary">{t('plans.itemTypeLabel')}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {ITEM_TYPES.map((type) => (
            <label key={type} className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium ${itemType === type ? 'border-moss text-moss' : 'border-hairline text-ink'}`}>
              <input type="radio" name="plan-item-type" value={type} checked={itemType === type} onChange={() => { setItemType(type); setRecordId('') }} className="sr-only" />
              {t(`plans.itemTypes.${type}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {itemType === 'step' ? (
        <div>
          <label htmlFor="plan-item-step" className="text-xs text-secondary">{t('plans.stepLabel')}</label>
          <input id="plan-item-step" value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} maxLength={200} placeholder={t('plans.stepPlaceholder')} className={inputClass} />
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
  )
}

function ItemEditForm({ item, sections, busy, onSubmit, onCancel }) {
  const { t } = useLanguage()
  const [stepTitle, setStepTitle] = useState(item.step_title ?? '')
  const [targetOn, setTargetOn] = useState(item.target_on ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [sectionId, setSectionId] = useState(item.section_id ?? '')
  const [error, setError] = useState(null)
  const idPrefix = `plan-item-${item.id}`
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (item.item_type === 'step' && !stepTitle.trim()) return setError(t('plans.errorStepTitle'))
        setError(null)
        onSubmit({ targetOn, note, sectionId, stepTitle: item.item_type === 'step' ? stepTitle : undefined })
      }}
    >
      {item.item_type === 'step' && (
        <div>
          <label htmlFor={`${idPrefix}-step`} className="text-xs text-secondary">{t('plans.stepLabel')}</label>
          <input id={`${idPrefix}-step`} value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} maxLength={200} className={inputClass} />
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
