import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { getNavVisibility } from '../lib/navVisibility'

const NavVisibilityContext = createContext(undefined)

const DEFAULT_NAV_VISIBILITY = { hasSkills: true, hasCourses: true, hasConnectionsActivity: true }

// Lives above the router (see App.jsx), same reasoning as
// PendingActionsContext -- AppHeader remounts fresh on every page navigation
// (each page renders its own <AppHeader />), so computing this locally
// inside AppHeader meant every click briefly re-showed the hidden tabs while
// the count queries were back in flight, before hiding them again. Keeping
// the result up here instead means it's fetched once per session and just
// carried across navigations.
export function NavVisibilityProvider({ children }) {
  const { user } = useAuth()
  const [navVisibility, setNavVisibility] = useState(DEFAULT_NAV_VISIBILITY)

  const refreshNavVisibility = useCallback(async () => {
    if (!user) {
      setNavVisibility(DEFAULT_NAV_VISIBILITY)
      return
    }
    setNavVisibility(await getNavVisibility(user.id))
  }, [user])

  useEffect(() => {
    refreshNavVisibility()
  }, [refreshNavVisibility])

  return (
    <NavVisibilityContext.Provider value={{ navVisibility, refreshNavVisibility }}>
      {children}
    </NavVisibilityContext.Provider>
  )
}

export function useNavVisibility() {
  const ctx = useContext(NavVisibilityContext)
  if (ctx === undefined) throw new Error('useNavVisibility must be used within a NavVisibilityProvider')
  return ctx
}
