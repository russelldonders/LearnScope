import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { listConnections } from '../lib/connections'
import {
  getActorName,
  getPlan,
  inviteConnectionsToPlan,
  listPlanMembers,
  loadPlanContext,
  recordPlanProgress,
  savePositions,
} from '../lib/learnerPlans'
import { planProgressEntry } from '../lib/planProgress'
import { getPlanPrerequisites } from '../lib/planSettings'

// A plan and the records its items point at. `run` wraps a change to the
// plan: it shows the change as busy, reloads afterwards and reports any
// error, returning whether it worked.
export function usePlanData(planId) {
  const { user } = useAuth()
  const [plan, setPlan] = useState(null)
  const [context, setContext] = useState(null)
  // The plan's prerequisites, each marked met or not for the viewer.
  const [prerequisites, setPrerequisites] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
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
    const [nextContext, nextPrerequisites] = await Promise.all([
      loadPlanContext(user.id, loaded.items),
      getPlanPrerequisites(loaded.id),
    ])
    setContext(nextContext)
    setPrerequisites(nextPrerequisites)
    // Everyone's progress on a shared plan is shared with its owners; keep
    // the viewer's up to date, and say so to a follower. Best effort.
    recordPlanProgress([planProgressEntry(loaded, nextContext)])
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

  return {
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
  }
}

// Who the invite dialog should show as already invited or on the plan: by
// person, 'accepted' for anyone on it, else their invitation's status.
function invitationStatuses(everyone) {
  return everyone
    .filter((row) => row.user_id)
    .map((row) => ({ recipient_id: row.user_id, status: row.status === 'member' ? 'accepted' : row.status }))
}

// Sharing a plan: inviting connections to it, and "Manage users" -- the
// people invited to it and their progress.
export function usePlanSharing(plan) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteConnections, setInviteConnections] = useState([])
  const [planInvitations, setPlanInvitations] = useState([])
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [inviteNotice, setInviteNotice] = useState(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const [members, setMembers] = useState([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState(null)

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

  return {
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
  }
}

// Reordering a plan's items and sections, by the arrow buttons or by
// dragging. `run` is usePlanData's, so every move is saved and reloaded.
export function usePlanReorder(busy, run) {
  const [dragging, setDragging] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  // The drag in progress, for pointer events that arrive before a re-render.
  const dragRef = useRef(null)

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

  return {
    dragging,
    dragOver,
    move,
    dragHandlers,
  }
}
