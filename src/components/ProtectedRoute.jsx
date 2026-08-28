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

  if (needsOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return children
}
