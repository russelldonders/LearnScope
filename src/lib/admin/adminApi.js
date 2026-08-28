import { supabase } from '../supabaseClient'

// Shared caller for the single service-role admin/org action dispatcher at
// api/admin/actions.js -- same auth-header pattern as Profile.jsx's
// existing call to /api/delete-account. Every admin/org privileged action
// goes through this one endpoint (rather than one function per action) to
// stay under Vercel's per-deployment serverless function cap.
export async function callAdminApi(action, payload) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/admin/actions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed.')
  return data
}
