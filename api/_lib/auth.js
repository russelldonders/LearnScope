function jwtSessionId(accessToken) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload.session_id === 'string' ? payload.session_id : null
  } catch {
    return null
  }
}

async function findImpersonation(accessToken) {
  const sessionId = jwtSessionId(accessToken)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!sessionId || !serviceRoleKey) return null
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const params = new URLSearchParams({
    auth_session_id: `eq.${sessionId}`,
    select: 'id,target_user_id,expires_at,ended_at',
    limit: '1',
  })
  const res = await fetch(`${supabaseUrl}/rest/v1/admin_impersonation_sessions?${params}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })
  if (!res.ok) return { lookupFailed: true }
  const rows = await res.json()
  return rows[0] ?? null
}

export async function verifySupabaseUser(accessToken, { allowImpersonation = false } = {}) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!res.ok) return null
  const user = await res.json()
  const impersonation = await findImpersonation(accessToken)
  if (impersonation?.lookupFailed) return null
  if (impersonation && !allowImpersonation) return null
  return impersonation ? { ...user, __impersonation: impersonation } : user
}
