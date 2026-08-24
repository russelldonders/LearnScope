import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProtectedRoute from './ProtectedRoute'

// Wraps ProtectedRoute with an additional check for the provider console:
// any organisation_members row (admin or trainer) grants access -- both
// roles can submit training per course_catalogue's RLS, staff management is
// gated separately per-organisation inside the console itself. Mirrors
// PlatformAdminRoute's null-until-known loading handling.
export default function ProviderAdminRoute({ children }) {
  return (
    <ProtectedRoute>
      <RequireOrganisationMember>{children}</RequireOrganisationMember>
    </ProtectedRoute>
  )
}

function RequireOrganisationMember({ children }) {
  const { organisationMemberships } = useAuth()

  if (organisationMemberships === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  if (organisationMemberships.length === 0) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
