import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProtectedRoute from './ProtectedRoute'

// Wraps ProtectedRoute with an additional platform-admin check, for the
// /admin console. Mirrors ProtectedRoute's own loading-state handling: while
// isPlatformAdmin is still null (not yet checked), show a loading state
// rather than redirecting -- otherwise a real admin would get bounced to
// /dashboard for a moment on every load before the check resolves.
export default function PlatformAdminRoute({ children }) {
  return (
    <ProtectedRoute>
      <RequirePlatformAdmin>{children}</RequirePlatformAdmin>
    </ProtectedRoute>
  )
}

function RequirePlatformAdmin({ children }) {
  const { isPlatformAdmin } = useAuth()

  if (isPlatformAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  if (!isPlatformAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
