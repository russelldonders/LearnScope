import { useEffect, useMemo, useState } from 'react'
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
import PlanSettingsDialog from '../components/PlanSettingsDialog'
import { prerequisiteLabel, summarisePrerequisites } from '../lib/planSettings'
import { PlanDetailsForm } from './Plans'
import {
  addItem,
  addSection,
  deletePlan,
  deleteSection,
  getItemActivity,
  leavePlan,
  linkPlanItemsForMe,
  removePlanMember,
  setPlanMemberRole,
  removeItem,
  setItemDone,
  setPlanStatus,
  startPlan,
  updateItem,
  updatePlan,
  updateSection,
  withdrawPlanInvitation,
} from '../lib/learnerPlans'
import { formatPlanTimeframe, paceOf, planItemStatus, sequenceLocks, summariseProgress, timeElapsedPercent } from '../lib/planProgress'
import { formatFullDate } from '../lib/dates'
import { DragHandle, IconButton, PlanItem } from './PlanItem'
import { AddItemForm, ItemEditForm, SectionForm } from './PlanItemForms'
import { usePlanData, usePlanReorder, usePlanSharing } from './usePlanDetail'

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
  const {
    plan,
    context,
    prerequisites,
    loading,
    notFound,
    error,
    setError,
    busy,
    setBusy,
    progressShared,
    actorName,
    load,
    run,
  } = usePlanData(planId)
  const [editingDetails, setEditingDetails] = useState(false)
  const [addingTo, setAddingTo] = useState(null)
  const [addingSection, setAddingSection] = useState(false)
  const [editingItemId, setEditingItemId] = useState(null)
  const [editingSectionId, setEditingSectionId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  // The plan's order and prerequisites, behind the cog in edit mode.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const {
    dragging,
    dragOver,
    move,
    dragHandlers,
  } = usePlanReorder(busy, run)
  const {
    inviteOpen,
    setInviteOpen,
    inviteConnections,
    planInvitations,
    inviteBusy,
    inviteError,
    inviteNotice,
    membersOpen,
    setMembersOpen,
    members,
    membersLoading,
    membersError,
    setMembersError,
    openInvites,
    loadMembers,
    openMembers,
    sendInvites,
  } = usePlanSharing(plan)
  // A goal in the plan, shown as its own tile in a pop-up.
  const [openGoalId, setOpenGoalId] = useState(null)
  const statusById = useMemo(() => {
    if (!plan || !context) return new Map()
    return new Map(plan.items.map((item) => [item.id, planItemStatus(item, context)]))
  }, [plan, context])

  // Opened at one step (?item=, from that step's activity on a timeline):
  // scrolled to and picked out for a moment, once the plan is there.
  const focusItemId = searchParams.get('item')
  const [highlightedItemId, setHighlightedItemId] = useState(null)
  const focusReady = Boolean(plan && focusItemId && plan.items.some((item) => item.id === focusItemId))
  useEffect(() => {
    if (!focusReady) return undefined
    document.getElementById(`plan-item-${focusItemId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    setHighlightedItemId(focusItemId)
    const timer = setTimeout(() => setHighlightedItemId(null), 4000)
    return () => clearTimeout(timer)
  }, [focusReady, focusItemId])

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
  // Working through the plan, an activity is locked while the plan's
  // required prerequisites aren't met, or (in a plan done in order) while
  // something before it isn't finished. Editing never locks anything.
  const prereqs = summarisePrerequisites(prerequisites)
  const lockedIds = editing
    ? new Set()
    : prereqs.blocked
      ? new Set(contentItems.map((item) => item.id))
      : sequenceLocks(plan.sequence, groups.map(({ items }) => items), statusById)

  function renderItem(item, index, items, listKey) {
    const isDropTarget = dragOver?.kind === 'item' && dragOver.id === item.id && dragging?.id !== item.id
    const isDraggingItem = dragging?.kind === 'item' && dragging.id === item.id
    return (
      <li
        key={item.id}
        id={`plan-item-${item.id}`}
        data-highlighted={highlightedItemId === item.id ? '' : undefined}
        data-drop-kind="item"
        data-drop-id={item.id}
        data-drop-list={listKey}
        className={`relative rounded-md border bg-card p-3 scroll-mt-24 transition-[border-color,background-color,opacity,box-shadow] ${isDropTarget ? 'border-moss bg-moss/5 ring-2 ring-moss/40' : highlightedItemId === item.id ? 'border-gold ring-2 ring-gold/40' : 'border-hairline'} ${isDraggingItem ? 'opacity-60 shadow-lg' : ''} ${!editing && item.item_type === 'step' && !lockedIds.has(item.id) ? 'hover:border-moss/50' : ''}`}
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
            locked={lockedIds.has(item.id) ? (prereqs.blocked ? 'prerequisites' : 'sequence') : null}
            backState={backState}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            dragHandlers={dragHandlers({ kind: 'item', id: item.id, listKey, table: 'learner_plan_items', list: items })}
            onMoveUp={() => move(items, index, -1, 'learner_plan_items')}
            onMoveDown={() => move(items, index, 1, 'learner_plan_items')}
            onComplete={(values) => run(() => setItemDone(item, true, { userId: user.id, actor: { name: actorName, email: user.email }, plan: { id: plan.id, title: plan.title }, ...values }))}
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
                {formatPlanTimeframe(plan, t)}
                {plan.status !== 'active' && ` · ${t(`plans.status.${plan.status}`)}`}
                {plan.status === 'completed' && plan.completed_on && ` ${formatFullDate(plan.completed_on)}`}
              </p>
            </div>
            {editing ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setEditingDetails(true)} className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:border-moss">
                  {t('plans.editDetails')}
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label={t('plans.settings.open')}
                  title={t('plans.settings.open')}
                  className="relative grid h-8 w-8 place-items-center rounded-md text-secondary hover:bg-card hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-moss"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {/* A quiet dot says some settings are on. */}
                  {(prereqs.any || (plan.sequence && plan.sequence !== 'none')) && (
                    <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-moss" />
                  )}
                </button>
              </div>
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
          {plan.organisation ? (
            <p data-progress-shared="" className="mt-2 text-xs text-secondary">{t('plans.organisationPlanNote', { employer: plan.organisation.name })}</p>
          ) : progressShared && <p data-progress-shared="" className="mt-2 text-xs text-secondary">{t('plans.progressSharedNote')}</p>}
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

      {/* What the plan asks for before starting, met or not from the
          viewer's own records. Only shown when it asks for something. */}
      {!editing && prereqs.any && (
        <PrerequisitesPanel summary={prereqs} t={t} />
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

      {settingsOpen && editing && (
        <PlanSettingsDialog
          plan={plan}
          prerequisites={prerequisites}
          busy={busy}
          run={run}
          onClose={() => setSettingsOpen(false)}
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
              {plan.sequence && plan.sequence !== 'none' && (
                <p data-sequence={plan.sequence} className="mt-0.5 text-xs text-secondary">{t(`plans.sequenceNote.${plan.sequence}`)}</p>
              )}
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

// "Before you start": each group of prerequisites, met or not. Folded away
// once everything is met; open while something isn't.
function PrerequisitesPanel({ summary, t }) {
  const [open, setOpen] = useState(!summary.allMet)
  return (
    <section
      aria-labelledby="plan-prerequisites-heading"
      data-prerequisites={summary.blocked ? 'blocked' : summary.allMet ? 'met' : 'unmet'}
      className={`mt-6 rounded-xl border px-5 py-3 ${summary.blocked ? 'border-gold/50 bg-gold/10' : 'border-hairline bg-card'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="plan-prerequisites-heading" className="text-xs font-medium uppercase tracking-wide text-secondary">{t('plans.prerequisites.heading')}</h2>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="text-xs font-medium text-moss hover:underline">
          {summary.allMet ? t('plans.prerequisites.allMet') : open ? t('plans.prerequisites.hide') : t('plans.prerequisites.show')}
        </button>
      </div>
      {summary.blocked && <p className="mt-1 text-sm text-ink">{t('plans.prerequisites.blocked')}</p>}
      {open && (
        <ul className="mt-2 space-y-2">
          {summary.groups.map((group) => (
            <li key={group.id} className="text-sm">
              <p className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                <span>{group.options.length > 1 ? t('plans.settings.anyOneOf') : t('plans.settings.needs')}</span>
                <span className="rounded-full border border-hairline px-1.5 py-px text-[10px]">{t(`plans.settings.enforcement.${group.enforcement}`)}</span>
              </p>
              <ul className="mt-1 space-y-0.5">
                {group.options.map((option) => (
                  <li key={option.id} data-met={option.met ? 'true' : 'false'} className="flex items-start gap-2">
                    <span aria-hidden="true" className={`mt-0.5 shrink-0 text-xs ${option.met ? 'text-moss' : 'text-secondary'}`}>{option.met ? '✓' : '○'}</span>
                    <span className="min-w-0 break-words text-ink">
                      {prerequisiteLabel(option, t)}
                      <span className="sr-only"> — {option.met ? t('plans.prerequisites.met') : t('plans.prerequisites.notMet')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
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

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
