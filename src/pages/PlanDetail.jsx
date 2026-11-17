import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import AppHeader from '../components/AppHeader'
import AccessibleDialog from '../components/AccessibleDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import { SkillGoalTile } from '../components/SkillGoalsDashboardPanel'
import PlanProgressBar from '../components/PlanProgressBar'
import PlanInviteDialog from '../components/PlanInviteDialog'
import PlanMembersDialog from '../components/PlanMembersDialog'
import { listConnections } from '../lib/connections'
import { PlanDetailsForm } from './Plans'
import { addItem, addSection, deletePlan, deleteSection, getActorName, getItemActivity, getPlan, inviteConnectionsToPlan, leavePlan, linkPlanItemsForMe, listPlanMembers, removePlanMember, setPlanMemberRole, loadPlanContext, recordPlanProgress, removeItem, savePositions, setItemDone, setPlanStatus, startPlan, updateItem, updatePlan, updateSection, withdrawPlanInvitation } from '../lib/learnerPlans'
import { paceOf, planItemStatus, summariseProgress, timeElapsedPercent } from '../lib/planProgress'
import { formatFullDate } from '../lib/dates'
import { DragHandle, IconButton, PlanItem } from './PlanItem'
import { AddItemForm, ItemEditForm, SectionForm } from './PlanItemForms'

// A learner's plan: its sections in order, each with its items, every item's
// state worked out from the record it points at (planProgress.js).
//
// Two modes, kept apart so working through a plan never risks changing it:
//   use  -- follow progress, tick off steps and resources, set a missing
//           plan-specific skill target. Nothing else can change.
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
  const [dragging, setDragging] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  // The drag in progress, for pointer events that arrive before a re-render.
  const dragRef = useRef(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteConnections, setInviteConnections] = useState([])
  const [planInvitations, setPlanInvitations] = useState([])
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [inviteNotice, setInviteNotice] = useState(null)
  // A goal in the plan, shown as its own tile in a pop-up.
  const [openGoalId, setOpenGoalId] = useState(null)
  // "Manage users": the people invited to this plan and their progress.
  const [membersOpen, setMembersOpen] = useState(false)
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState(null)
  // The viewer follows this plan, so their progress is shared with its owners.
  const [progressShared, setProgressShared] = useState(false)
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
    const nextContext = await loadPlanContext(user.id, loaded.items)
    setContext(nextContext)
    // Everyone's progress on a shared plan is shared with its owners; keep
    // the viewer's up to date, and say so to a follower. Best effort.
    const { done, total } = summariseProgress(loaded.items.map((item) => planItemStatus(item, nextContext)))
    recordPlanProgress([{ planId: loaded.id, done, total }])
      .then((shared) => setProgressShared(shared.has(loaded.id)))
      .catch(() => {})
    return nextContext
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

  async function openInvites() {
    setInviteError(null)
    setInviteNotice(null)
    setInviteOpen(true)
    setInviteBusy(true)
    try {
      const [connections, everyone] = await Promise.all([
        listConnections(user.id),
        listPlanMembers(plan.id),
      ])
      setInviteConnections(connections)
      setPlanInvitations(invitationStatuses(everyone))
    } catch (err) {
      setInviteError(err.message)
    } finally {
      setInviteBusy(false)
    }
  }

  async function loadMembers() {
    setMembersError(null)
    setMembersLoading(true)
    try {
      setMembers(await listPlanMembers(plan.id))
    } catch (err) {
      setMembersError(err.message)
    } finally {
      setMembersLoading(false)
    }
  }

  function openMembers() {
    setInviteNotice(null)
    setMembersOpen(true)
    loadMembers()
  }

  async function sendInvites(recipientIds) {
    setInviteError(null)
    setInviteBusy(true)
    try {
      const sent = await inviteConnectionsToPlan(plan.id, recipientIds)
      setPlanInvitations(invitationStatuses(await listPlanMembers(plan.id)))
      setInviteOpen(false)
      if (membersOpen) loadMembers()
      setInviteNotice(t('plans.inviteSent', { count: sent.filter((row) => row.created).length }))
    } catch (err) {
      setInviteError(err.message)
    } finally {
      setInviteBusy(false)
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
  // Owners (the creator and co-owners) change the plan and invite people;
  // followers work through it. Only the creator deletes it; anyone else can
  // leave it.
  const canManage = plan.my_role === 'owner'
  const isCreator = Boolean(plan.is_creator)
  // Where a page opened from this plan should lead back to: here, in the same
  // mode. Course pages read backTo/backLabel, skill pages from/fromLabel.
  const here = `/plans/${plan.id}${searchParams.toString() ? `?${searchParams}` : ''}`
  const backState = { backTo: here, backLabel: plan.title, from: here, fromLabel: plan.title }
  const editing = canManage && (planning || searchParams.get('mode') === 'edit')
  // Items someone else added that the viewer hasn't added to their own records.
  const unlinkedCount = plan.items.filter((item) => item.needs_link).length
  const progress = summariseProgress([...statusById.values()])
  const remaining = Math.max(0, progress.total - progress.done)
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
  const skillItems = plan.items.filter((item) => item.item_type === 'skill')
  const contentItems = plan.items.filter((item) => item.item_type !== 'skill')
  const groups = [
    { section: null, items: contentItems.filter((item) => !item.section_id) },
    ...plan.sections.map((section) => ({ section, items: contentItems.filter((item) => item.section_id === section.id) })),
  ]

  async function move(list, index, delta, table) {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    const reordered = [...list]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    await run(() => savePositions(table, reordered.map((row, position) => ({ id: row.id, position }))))
  }

  async function reorder(list, fromId, toId, table) {
    const from = list.findIndex((row) => row.id === fromId)
    const to = list.findIndex((row) => row.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const reordered = [...list]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    await run(() => savePositions(table, reordered.map((row, position) => ({ id: row.id, position }))))
  }

  // Dragging works by pointer (mouse, touch or pen) rather than the
  // browser's own drag and drop, which touch screens don't support: the
  // handle keeps the pointer while it moves, and whichever tile of the same
  // list is under it is the drop target. Near the top or bottom of the
  // window, the page scrolls along.
  function dropTargetAt(event, payload) {
    const element = document.elementFromPoint?.(event.clientX, event.clientY)
    const target = element?.closest?.(`[data-drop-kind="${payload.kind}"][data-drop-list="${payload.listKey}"]`)
    return target?.dataset.dropId ?? null
  }

  function dragHandlers(payload) {
    return {
      onPointerDown(event) {
        if (busy || (event.pointerType === 'mouse' && event.button !== 0)) return
        event.preventDefault()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        dragRef.current = payload
        setDragging(payload)
        setDragOver(null)
      },
      onPointerMove(event) {
        if (dragRef.current?.id !== payload.id) return
        const targetId = dropTargetAt(event, payload)
        setDragOver(targetId && targetId !== payload.id ? { kind: payload.kind, id: targetId } : null)
        const edge = 72
        if (event.clientY < edge) window.scrollBy?.(0, -16)
        else if (event.clientY > window.innerHeight - edge) window.scrollBy?.(0, 16)
      },
      onPointerUp(event) {
        if (dragRef.current?.id !== payload.id) return
        const targetId = dropTargetAt(event, payload)
        dragRef.current = null
        setDragging(null)
        setDragOver(null)
        if (targetId) reorder(payload.list, payload.id, targetId, payload.table)
      },
      onPointerCancel() {
        dragRef.current = null
        setDragging(null)
        setDragOver(null)
      },
    }
  }

  function renderItem(item, index, items, listKey) {
    const isDropTarget = dragOver?.kind === 'item' && dragOver.id === item.id && dragging?.id !== item.id
    const isDraggingItem = dragging?.kind === 'item' && dragging.id === item.id
    return (
      <li
        key={item.id}
        data-drop-kind="item"
        data-drop-id={item.id}
        data-drop-list={listKey}
        className={`relative rounded-md border bg-card p-3 transition-[border-color,background-color,opacity,box-shadow] ${isDropTarget ? 'border-moss bg-moss/5 ring-2 ring-moss/40' : 'border-hairline'} ${isDraggingItem ? 'opacity-60 shadow-lg' : ''} ${!editing && item.item_type === 'step' ? 'hover:border-moss/50' : ''}`}
      >
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
            dragHandlers={dragHandlers({ kind: 'item', id: item.id, listKey, table: 'learner_plan_items', list: items })}
            onMoveUp={() => move(items, index, -1, 'learner_plan_items')}
            onMoveDown={() => move(items, index, 1, 'learner_plan_items')}
            onComplete={(values) => run(() => setItemDone(item, true, { userId: user.id, actor: { name: actorName, email: user.email }, ...values }))}
            onUntick={(removeActivity) => run(() => setItemDone(item, false, { userId: user.id, actor: { name: actorName, email: user.email }, removeActivity }))}
            onLoadActivity={() => getItemActivity(item)}
            onEdit={() => setEditingItemId(item.id)}
            onRemove={() => setConfirm({ kind: 'item', item })}
            onOpenGoal={setOpenGoalId}
          />
        )}
      </li>
    )
  }

  return (
    <Shell>
      <Link to="/plans" className="text-sm text-moss font-medium hover:underline">{t('plans.backToPlans')}</Link>

      {editing && (
        <div data-mode="edit" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold/50 bg-gold/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{planning ? t('plans.planningBannerTitle') : t('plans.editBannerTitle')}</p>
            <p className="text-xs text-secondary">{planning ? t('plans.planningBannerHint') : t('plans.editBannerHint')}</p>
            <p className="text-xs text-secondary">{t('plans.dragReorderHint')}</p>
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
            ) : !canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <span data-role="follower" className="rounded-full border border-hairline px-2.5 py-1 text-xs text-secondary">{t('plans.youFollowThisPlan')}</span>
                <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'leave' })} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-secondary hover:text-ink disabled:opacity-60">
                  {t('plans.leavePlan')}
                </button>
              </div>
            ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={openMembers} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss">
                {t('plans.manageUsers')}
              </button>
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
              {!isCreator && (
                <button type="button" disabled={busy} onClick={() => setConfirm({ kind: 'leave' })} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-secondary hover:text-ink disabled:opacity-60">
                  {t('plans.leavePlan')}
                </button>
              )}
            </div>
            )}
          </div>
          {plan.description && <p className="mt-2 text-sm text-ink whitespace-pre-wrap break-words max-w-2xl">{plan.description}</p>}
          {progressShared && <p data-progress-shared="" className="mt-2 text-xs text-secondary">{t('plans.progressSharedNote')}</p>}
          {inviteNotice && <p role="status" className="mt-3 text-sm text-moss">{inviteNotice}</p>}
        </div>
      )}

      {/* Items added since the viewer joined (or by a co-owner) point at
          someone else's records; nothing is made in theirs until they ask. */}
      {unlinkedCount > 0 && (
        <div data-unlinked="" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-card px-4 py-3">
          <p className="min-w-0 text-sm text-ink">{t('plans.unlinkedItems', { count: unlinkedCount })}</p>
          <button type="button" disabled={busy} onClick={() => run(() => linkPlanItemsForMe(plan.id))} className="shrink-0 rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss disabled:opacity-60">
            {t('plans.addToMyRecords')}
          </button>
        </div>
      )}

      {!editing && (
      <section aria-labelledby="plan-progress-heading" className="mt-6 rounded-xl border border-hairline bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="plan-progress-heading" className="text-xs font-medium uppercase tracking-wide text-secondary">{t('plans.progressHeading')}</h2>
            <p className="mt-1 flex items-baseline gap-2 text-ink">
              <span className="font-display text-4xl tabular-nums leading-none">{progress.percent}%</span>
              <span className="text-sm text-secondary">{t('plans.complete')}</span>
            </p>
          </div>
          {pace && (
            <span data-pace={pace} className={`rounded-full px-2.5 py-1 text-xs font-medium ${pace === 'behind' ? 'bg-red-700/15 text-red-700' : pace === 'ahead' ? 'bg-moss/15 text-moss' : 'bg-gold/15 text-gold'}`}>
              {t(`plans.pace.${pace}`)}
            </span>
          )}
        </div>
        <PlanProgressBar className="mt-4" percent={progress.percent} elapsed={elapsed} label={t('plans.progressLabel', { title: plan.title })} />
        <div className="mt-2 flex items-center justify-between gap-4 text-xs text-secondary">
          <span>{t('plans.completedCount', { count: progress.done })}</span>
          <span>{t('plans.remainingCount', { count: remaining })}</span>
        </div>
        {(elapsed != null || progress.overdue > 0) && (
          <div className="mt-4 border-t border-hairline pt-3 text-xs text-secondary">
            {elapsed != null && t('plans.timelineElapsed', { percent: elapsed })}
            {elapsed != null && progress.overdue > 0 && ' · '}
            {progress.overdue > 0 && <span className="font-medium text-red-700">{t('plans.overdueCount', { count: progress.overdue })}</span>}
          </div>
        )}
      </section>
      )}

      {!editing && plan.items.length === 0 && (
        <div className="mt-6 text-center py-12 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">{t('plans.emptyPlan')}</p>
          {canManage && <button type="button" onClick={() => setEditing(true)} className="mt-3 text-sm text-moss font-medium hover:underline">{t('plans.editPlan')}</button>}
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

      {membersOpen && (
        <PlanMembersDialog
          planTitle={plan.title}
          members={members}
          loading={membersLoading}
          error={membersError}
          onClose={() => setMembersOpen(false)}
          currentUserId={user.id}
          onInvite={openInvites}
          onRemove={async (member) => {
            setMembersError(null)
            try {
              await removePlanMember(plan.id, member.user_id)
            } catch (err) {
              setMembersError(err.message)
            }
            await loadMembers()
          }}
          onSetRole={async (member, role) => {
            setMembersError(null)
            try {
              await setPlanMemberRole(plan.id, member.user_id, role)
            } catch (err) {
              setMembersError(err.message)
            }
            await loadMembers()
          }}
          onWithdraw={async (member) => {
            setMembersError(null)
            try {
              await withdrawPlanInvitation(member.invitation_id)
            } catch (err) {
              setMembersError(err.message)
            }
            await loadMembers()
          }}
          t={t}
        />
      )}

      {inviteOpen && (
        <PlanInviteDialog
          planId={plan.id}
          planTitle={plan.title}
          onInvited={() => { if (membersOpen) loadMembers() }}
          connections={inviteConnections}
          invitations={planInvitations}
          busy={inviteBusy}
          error={inviteError}
          onClose={() => setInviteOpen(false)}
          onInvite={sendInvites}
          t={t}
        />
      )}

      {openGoalId && context?.goalItemsById?.has(openGoalId) && (
        <GoalTileDialog
          item={context.goalItemsById.get(openGoalId)}
          user={user}
          actor={{ name: actorName, email: user.email }}
          onClose={() => setOpenGoalId(null)}
          // Logging from the tile reloads the plan too, so the item's state
          // moves on, and hands the tile its goal back with the new entries.
          onChanged={async () => {
            const next = await load()
            return next ? [...next.goalItemsById.values()] : []
          }}
        />
      )}

      <div className="mt-6 space-y-6">
        {(contentItems.length > 0 || editing) && (
          <div>
            <div className="border-b border-hairline pb-2">
              <h2 id="plan-activities-heading" className="font-display text-xl text-ink">{t('plans.activitiesSectionTitle')}</h2>
              <p className="text-xs text-secondary">{t('plans.activitiesSectionHint')}</p>
            </div>
          </div>
        )}

        {groups.map(({ section, items }, groupIndex) => {
          const sectionProgress = summariseProgress(items.map((item) => statusById.get(item.id) ?? { state: 'not_started' }))
          if (!section && items.length === 0 && (plan.sections.length > 0 || !editing)) return null
          if (section && items.length === 0 && !editing) return null
          const sectionIndex = groupIndex - 1
          const listKey = section?.id ?? 'top'
          const isSectionDropTarget = section && dragOver?.kind === 'section' && dragOver.id === section.id && dragging?.id !== section.id
          const isDraggingSection = section && dragging?.kind === 'section' && dragging.id === section.id
          return (
            <section
              key={listKey}
              aria-labelledby={section ? `plan-section-${section.id}` : undefined}
              data-drop-kind={section ? 'section' : undefined}
              data-drop-id={section?.id}
              data-drop-list={section ? 'sections' : undefined}
              className={`${isSectionDropTarget ? 'rounded-md bg-moss/5 outline outline-2 outline-moss/50 outline-offset-4' : ''} ${isDraggingSection ? 'opacity-60' : ''}`.trim() || undefined}
            >
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
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline pb-2">
                    <div className="flex min-w-0 items-stretch gap-3">
                    {editing && (
                      <DragHandle
                        label={t('plans.dragSection', { title: section.title })}
                        disabled={busy}
                        handlers={dragHandlers({ kind: 'section', id: section.id, listKey: 'sections', table: 'learner_plan_sections', list: plan.sections })}
                        onMoveUp={sectionIndex > 0 ? () => move(plan.sections, sectionIndex, -1, 'learner_plan_sections') : null}
                        onMoveDown={sectionIndex < plan.sections.length - 1 ? () => move(plan.sections, sectionIndex, 1, 'learner_plan_sections') : null}
                      />
                    )}
                    <div className="min-w-0">
                      <h3 id={`plan-section-${section.id}`} className="font-display text-lg text-ink break-words">{section.title}</h3>
                      <p className="text-xs text-secondary">
                        {t('plans.doneCount', { done: sectionProgress.done, total: sectionProgress.total })}
                        {section.target_on && ` · ${t('plans.byDate', { date: formatFullDate(section.target_on) })}`}
                      </p>
                    </div>
                    </div>
                    {editing && (
                    <div className="flex items-center gap-2 text-xs">
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
                {items.map((item, index) => renderItem(item, index, items, listKey))}
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

        {(skillItems.length > 0 || editing) && (
          <section aria-labelledby="plan-skills-heading">
            <div className="border-b border-hairline pb-2">
              <h2 id="plan-skills-heading" className="font-display text-xl text-ink">{t('plans.skillsSectionTitle')}</h2>
              <p className="text-xs text-secondary">{t('plans.skillsSectionHint')}</p>
            </div>
            {skillItems.length === 0 && editing && <p className="mt-2 text-sm text-secondary">{t('plans.skillsSectionEmpty')}</p>}
            <ul className="mt-2 space-y-2">
              {skillItems.map((item, index) => renderItem(item, index, skillItems, 'skills'))}
            </ul>
            {editing && (addingTo === 'skills' ? (
              <AddItemForm
                userId={user.id}
                busy={busy}
                allowedTypes={['skill']}
                onCancel={() => setAddingTo(null)}
                onSubmit={async (values) => {
                  const ok = await run(() => addItem(plan.id, { ...values, sectionId: null, position: skillItems.length }))
                  if (ok) setAddingTo(null)
                }}
              />
            ) : (
              <button type="button" onClick={() => setAddingTo('skills')} className="mt-2 text-sm text-moss font-medium hover:underline">
                {t('plans.addSkill')}
              </button>
            ))}
          </section>
        )}
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
        {isCreator && (
        <p className="mt-6">
          <button type="button" onClick={() => setConfirm({ kind: 'plan' })} className="text-sm text-red-700 font-medium hover:underline">
            {t('plans.deletePlan')}
          </button>
        </p>
        )}
      </div>
      )}

      {confirm && (
        <ConfirmDialog
          message={
            confirm.kind === 'plan'
              ? t('plans.confirmDeletePlan', { title: plan.title })
              : confirm.kind === 'leave'
                ? t('plans.confirmLeavePlan', { title: plan.title })
                : confirm.kind === 'section'
                  ? t('plans.confirmDeleteSection', { title: confirm.section.title })
                  : t('plans.confirmRemoveItem')
          }
          confirmLabel={confirm.kind === 'item' ? t('plans.remove') : confirm.kind === 'leave' ? t('plans.leavePlan') : t('plans.delete')}
          confirming={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm.kind === 'plan' || confirm.kind === 'leave') {
              setBusy(true)
              try {
                await (confirm.kind === 'plan' ? deletePlan(plan.id) : leavePlan(plan.id))
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

    </Shell>
  )
}

// A goal in the plan as the same tile Home shows -- progress, history and
// logging -- without leaving the plan for the goal's skill page.
function GoalTileDialog({ item, user, actor, onClose, onChanged }) {
  const { t } = useLanguage()
  const [logging, setLogging] = useState(false)
  return (
    <AccessibleDialog
      labelledBy={`dashboard-goal-${item.goal.id}`}
      onClose={onClose}
      panelClassName="flex w-full max-w-sm max-h-[90vh] flex-col focus:outline-none"
    >
      <button
        type="button"
        aria-label={t('plans.closeGoal')}
        title={t('plans.closeGoal')}
        onClick={onClose}
        className="mb-2 grid h-8 w-8 shrink-0 place-items-center self-end rounded-full border border-hairline bg-card text-lg leading-none text-secondary shadow hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-moss"
      >
        <span aria-hidden="true">×</span>
      </button>
      <div className="min-h-0 overflow-y-auto rounded-lg shadow-xl">
        <SkillGoalTile
          item={item}
          user={user}
          actor={actor}
          open={logging}
          onToggle={() => setLogging((value) => !value)}
          onChanged={onChanged}
          linkToSkill={false}
        />
      </div>
    </AccessibleDialog>
  )
}

// Who the invite dialog should show as already invited or on the plan: by
// person, 'accepted' for anyone on it, else their invitation's status.
function invitationStatuses(everyone) {
  return everyone
    .filter((row) => row.user_id)
    .map((row) => ({ recipient_id: row.user_id, status: row.status === 'member' ? 'accepted' : row.status }))
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
