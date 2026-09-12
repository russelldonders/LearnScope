import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getEmployerLoginContext } from '../lib/employerRoleProfiles'
import ProtectedRoute from './ProtectedRoute'

// Learner-facing counterpart to EmployerAdminRoute: gates a route on the
// signed-in account holding *any* active employer_members row (admin or
// member) for the employer named by ?org=:slug, rather than requiring the
// 'admin' role EmployerAdminRoute needs for the separate console at
// /employer. Resolves the slug itself (get_employer_login_context,
// 20260912090000) rather than trusting anything Login.jsx already checked --
// this route is also reachable directly by URL, independent of how the
// learner signed in.
export default function EmployerMemberRoute({ children }) {
  return (
    <ProtectedRoute>
      <RequireEmployerMember>{children}</RequireEmployerMember>
    </ProtectedRoute>
  )
}

function RequireEmployerMember({ children }) {
  const { employerMemberships } = useAuth()
  const [searchParams] = useSearchParams()
  const orgSlug = searchParams.get('org')
  // undefined = not yet resolved, null = resolved to "not an employer org"
  const [employer, setEmployer] = useState(undefined)

  useEffect(() => {
    if (!orgSlug) {
      setEmployer(null)
      return
    }
    setEmployer(undefined)
    getEmployerLoginContext(orgSlug).then(setEmployer).catch(() => setEmployer(null))
  }, [orgSlug])

  if (employerMemberships === null || employer === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
        Loading…
      </div>
    )
  }

  if (!employer || !employerMemberships.some((m) => m.employer_id === employer.id)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
