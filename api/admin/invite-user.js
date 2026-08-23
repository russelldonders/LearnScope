import { verifySupabaseUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return
  }

  const caller = await verifySupabaseUser(authHeader.slice(7))
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  const { email, grantPlatformAdmin } = req.body ?? {}
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Missing email' })
    return
  }

  try {
    const admin = supabaseAdmin()

    // Re-check the caller's platform-admin status server-side against the
    // database -- never trust a client-supplied role claim, since this
    // route uses the service-role key and bypasses RLS entirely.
    const { data: callerAdminRow, error: callerCheckError } = await admin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()
    if (callerCheckError) throw callerCheckError
    if (!callerAdminRow) {
      res.status(403).json({ error: 'Platform admin access required' })
      return
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim())
    if (inviteError) throw inviteError

    if (grantPlatformAdmin) {
      const { error: grantError } = await admin
        .from('platform_admins')
        .insert({ user_id: invited.user.id, granted_by: caller.id })
      if (grantError) throw grantError
    }

    res.status(200).json({ ok: true, userId: invited.user.id })
  } catch (err) {
    console.error('admin/invite-user error:', err)
    res.status(500).json({ error: err.message || 'Failed to invite user.' })
  }
}
