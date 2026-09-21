import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProtectedRoute from './ProtectedRoute'

export default function ManagerRoute({ children }) {
  return (
    <ProtectedRoute>
      <RequireManagementContext>{children}</RequireManagementContext>
    </ProtectedRoute>
  )
}

function RequireManagementContext({ children }) {
  const { managerContexts, managerContextsError, refreshManagerContexts } = useAuth()

  if (managerContexts === null) {
    return (
      <div className="min-h-screen bg-paper px-4 py-16 text-center text-secondary">
        Checking team access…
      </div>
    )
  }

  if (managerContextsError) {
    return (
      <div className="min-h-screen bg-paper px-4 py-16 text-center">
        <p role="alert" className="text-sm text-red-700">We couldn’t verify your team access.</p>
        <button type="button" onClick={refreshManagerContexts} className="mt-4 rounded-md border border-moss px-4 py-2 text-sm font-medium text-moss hover:bg-card">
          Try again
        </button>
      </div>
    )
  }

  if (managerContexts.length === 0) return <Navigate to="/dashboard" replace />

  return children
}
