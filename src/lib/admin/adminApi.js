import { supabase } from '../supabaseClient'

// Shared caller for the service-role admin/org serverless endpoints under
// api/admin/ and api/org/ -- same auth-header pattern as Profile.jsx's
// existing call to /api/delete-account.
export async function callAdminApi(path, body) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed.')
  return data
}
