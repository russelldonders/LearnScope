import { Navigate, useLocation, useParams } from 'react-router-dom'

// Redirects an old URL to its new home, keeping its route params, query
// string and hash -- so bookmarks like /admin/catalogue/:id/edit?x=1 land on
// the matching /admin/courses/:id/edit?x=1. `to` builds the new path from the
// old route's params.
export default function LegacyRedirect({ to }) {
  const params = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`${to(params)}${search}${hash}`} replace />
}
