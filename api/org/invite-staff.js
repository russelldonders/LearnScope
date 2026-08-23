import { verifySupabaseUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

const VALID_ROLES = ['admin', 'trainer']

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

  const { organisationId, email, role } = req.body ?? {}
  if (!organisationId || !email || !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: 'Missing or invalid organisationId, email, or role' })
    return
  }

  try {
    const admin = supabaseAdmin()

    // Re-derive the caller's authority server-side -- platform admin, or an
    // 'admin' member of this specific organisation -- never trust the
    // client's claim about who they are.
    const { data: callerAdminRow, error: callerCheckError } = await admin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', caller.id)
      .maybeSingle()
    if (callerCheckError) throw callerCheckError

    if (!callerAdminRow) {
      const { data: memberRow, error: memberCheckError } = await admin
        .from('organisation_members')
        .select('role')
        .eq('organisation_id', organisationId)
        .eq('user_id', caller.id)
        .maybeSingle()
      if (memberCheckError) throw memberCheckError
      if (!memberRow || memberRow.role !== 'admin') {
        res.status(403).json({ error: 'Organisation admin access required' })
        return
      }
    }

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim())
    if (inviteError) throw inviteError

    const { error: memberInsertError } = await admin.from('organisation_members').insert({
      organisation_id: organisationId,
      user_id: invited.user.id,
      role,
      invited_by: caller.id,
    })
    if (memberInsertError) throw memberInsertError

    res.status(200).json({ ok: true, userId: invited.user.id })
  } catch (err) {
    console.error('org/invite-staff error:', err)
    res.status(500).json({ error: err.message || 'Failed to invite staff member.' })
  }
}
