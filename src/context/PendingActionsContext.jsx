import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabaseClient'
import { listIncomingRateInvites, listIncomingRecommendInvites } from '../lib/connections'
import { listMyPendingOrgInvites } from '../lib/organisationInvites'
import { listMyPendingEmployerInvites, listMyPendingDataAccessRequests } from '../lib/admin/employers'
import { listMyCourseAssignments } from '../lib/courseCatalogue'

const PendingActionsContext = createContext(undefined)

// Lives above the router (see App.jsx) rather than inside AppHeader, so the
// count survives page navigation and can be refreshed immediately by
// whichever page just resolved an item (e.g. Actions.jsx accepting a
// request) instead of only refetching on the next full page/header mount.
export function PendingActionsProvider({ children }) {
  const { user } = useAuth()
  const [pendingActionCount, setPendingActionCount] = useState(0)

  // Everything actually waiting on this learner to do something -- pending
  // connection requests, validation requests, organisation staff invites,
  // employer invites, employer data access requests, pushed course
  // assignments, and rate invites addressed to them -- not invites/requests
  // they sent themselves, which are waiting on someone else instead.
  const refreshPendingActionCount = useCallback(async () => {
    if (!user) {
      setPendingActionCount(0)
      return
    }
    const [
      { count: requestCount },
      { count: validationCount },
      rateInvites,
      recommendInvites,
      orgInvites,
      employerInvites,
      dataAccessRequests,
      courseAssignments,
    ] = await Promise.all([
      supabase
        .from('connection_requests')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('status', 'pending'),
      supabase
        .from('skill_validation_requests')
        .select('id', { count: 'exact', head: true })
        .eq('validator_id', user.id)
        .eq('status', 'pending'),
      listIncomingRateInvites(),
      listIncomingRecommendInvites(),
      listMyPendingOrgInvites(user.id),
      listMyPendingEmployerInvites(user.id),
      listMyPendingDataAccessRequests(user.id),
      listMyCourseAssignments(user.id),
    ])
    setPendingActionCount(
      (requestCount ?? 0) +
        (validationCount ?? 0) +
        rateInvites.length +
        recommendInvites.length +
        orgInvites.length +
        employerInvites.length +
        dataAccessRequests.length +
        courseAssignments.length
    )
  }, [user])

  useEffect(() => {
    refreshPendingActionCount()
  }, [refreshPendingActionCount])

  return (
    <PendingActionsContext.Provider value={{ pendingActionCount, refreshPendingActionCount }}>
      {children}
    </PendingActionsContext.Provider>
  )
}

export function usePendingActions() {
  const ctx = useContext(PendingActionsContext)
  if (ctx === undefined) throw new Error('usePendingActions must be used within a PendingActionsProvider')
  return ctx
}
