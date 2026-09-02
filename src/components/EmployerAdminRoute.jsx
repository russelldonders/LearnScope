import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProtectedRoute from './ProtectedRoute'

// Wraps ProtectedRoute with an additional check for the employer console:
// unlike ProviderAdminRoute (which grants access to any organisation_members
// row, admin or trainer), only an active 'admin' employer_members row grants
// access here -- phase 1 has no learner-facing UI for a plain 'member', and
// the console's own Learners tab is admin-only management of the roster, so
// there's nothing for a non-admin member to do here yet. Mirrors
// ProviderAdminRoute's null-until-known loading handling.
export default function EmployerAdminRoute({ children }) {
  return (
    <ProtectedRoute>
      <RequireEmployerAdmin>{children}</RequireEmployerAdmin>
    </ProtectedRoute>
  )
}

function RequireEmployerAdmin({ children }) {
  const { employerMemberships } = useAuth()

  if (employerMemberships === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  if (!employerMemberships.some((m) => m.role === 'admin')) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
