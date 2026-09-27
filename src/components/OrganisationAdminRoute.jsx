import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ProtectedRoute from './ProtectedRoute'

export default function OrganisationAdminRoute({ children }) {
  return (
    <ProtectedRoute>
      <RequireOrganisationAccess>{children}</RequireOrganisationAccess>
    </ProtectedRoute>
  )
}

function RequireOrganisationAccess({ children }) {
  const { organisationMemberships, employerMemberships } = useAuth()

  if (organisationMemberships === null || employerMemberships === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  const canAdminister = organisationMemberships.length > 0
    || employerMemberships.some((membership) => membership.role === 'admin')

  return canAdminister ? children : <Navigate to="/dashboard" replace />
}
