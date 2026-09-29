import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { loadNotifications } from '../lib/notifications'

const PendingActionsContext = createContext(undefined)

// Lives above the router (see App.jsx) rather than inside AppHeader, so the
// count survives page navigation and can be refreshed immediately by
// whichever page just resolved an item (e.g. Actions.jsx accepting a
// request) instead of only refetching on the next full page/header mount.
export function PendingActionsProvider({ children }) {
  const { user } = useAuth()
  const [pendingActionCount, setPendingActionCount] = useState(0)
  const [pendingActionItems, setPendingActionItems] = useState([])
  const [pendingActionsLoading, setPendingActionsLoading] = useState(false)
  const [pendingActionsError, setPendingActionsError] = useState(null)

  // Everything actually waiting on this learner to do something -- pending
  // connection requests, validation requests, organisation staff invites,
  // employer invites, employer data access requests, pushed course
  // assignments, pushed skill suggestions, and rate invites addressed to
  // them -- not invites/requests they sent themselves, which are waiting on
  // someone else instead. Unseen ratings received are the one purely
  // informational source here (nothing to accept/decline) -- included
  // anyway since the bell is the notification surface a learner already
  // checks, and it clears itself once they visit Actions.jsx (see
  // markPeerRatingsSeen there).
  const refreshPendingActionCount = useCallback(async () => {
    if (!user) {
      setPendingActionCount(0)
      setPendingActionItems([])
      setPendingActionsError(null)
      return
    }
    setPendingActionsLoading(true)
    try {
      const { items, failures } = await loadNotifications(user.id)
      setPendingActionItems(items)
      setPendingActionCount(items.length)
      setPendingActionsError(
        failures.length > 0 ? 'Some notifications could not be loaded. Try again to refresh the full list.' : null
      )
    } catch {
      setPendingActionsError('Notifications could not be loaded. Check your connection and try again.')
    } finally {
      setPendingActionsLoading(false)
    }
  }, [user])

  useEffect(() => {
    refreshPendingActionCount()
  }, [refreshPendingActionCount])

  return (
    <PendingActionsContext.Provider value={{
      pendingActionCount,
      pendingActionItems,
      pendingActionsLoading,
      pendingActionsError,
      refreshPendingActionCount,
    }}>
      {children}
    </PendingActionsContext.Provider>
  )
}

export function usePendingActions() {
  const ctx = useContext(PendingActionsContext)
  if (ctx === undefined) throw new Error('usePendingActions must be used within a PendingActionsProvider')
  return ctx
}
