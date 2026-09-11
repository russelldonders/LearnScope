import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, loading, needsOnboarding, needsName } = useAuth()
  const location = useLocation()

  if (loading || (user && (needsOnboarding === null || needsName === null))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Checked before onboarding: name is the more fundamental gap, and it's
  // the one Signup.jsx's own required fields don't close -- an account
  // created via an admin/provider invite skips Signup entirely and can
  // otherwise reach the rest of the app with no name ever set.
  if (needsName && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />
  }

  // Guarded on !needsName too: without it, a brand-new account (which has
  // neither a name nor onboarding_completed_at set) ping-pongs forever --
  // this check sends it to /onboarding, then the needsName check above
  // sends it right back to /profile once it lands there, tripping Safari's
  // history.replaceState() rate limit and blanking the page. Name must be
  // resolved first; onboarding is only offered once it is.
  if (needsOnboarding && !needsName && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return children
}
