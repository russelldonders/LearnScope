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

  const { userId, blocked } = req.body ?? {}
  if (!userId || typeof blocked !== 'boolean') {
    res.status(400).json({ error: 'Missing userId or blocked' })
    return
  }

  try {
    const admin = supabaseAdmin()

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

    if (blocked && userId === caller.id) {
      res.status(400).json({ error: "You can't block your own account." })
      return
    }

    // If the target is a platform admin, blocking them must not leave the
    // console with no one left who can un-block anyone -- check whether
    // any other platform admin is still unblocked before proceeding.
    if (blocked) {
      const { data: targetAdminRow, error: targetAdminError } = await admin
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (targetAdminError) throw targetAdminError

      if (targetAdminRow) {
        const { data: allAdmins, error: allAdminsError } = await admin.from('platform_admins').select('user_id')
        if (allAdminsError) throw allAdminsError

        const otherAdminIds = allAdmins.map((a) => a.user_id).filter((id) => id !== userId)
        let otherActiveAdminExists = false
        if (otherAdminIds.length > 0) {
          const { data: otherAdminProfiles, error: otherAdminProfilesError } = await admin
            .from('profiles')
            .select('id, account_status')
            .in('id', otherAdminIds)
          if (otherAdminProfilesError) throw otherAdminProfilesError
          otherActiveAdminExists = otherAdminProfiles.some((p) => p.account_status !== 'blocked')
        }

        if (!otherActiveAdminExists) {
          res.status(400).json({ error: 'Cannot block the last remaining platform admin.' })
          return
        }
      }
    }

    // '876000h' (100 years) is the conventional "effectively permanent" ban
    // used with Supabase's auth admin API; 'none' clears any active ban.
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: blocked ? '876000h' : 'none',
    })
    if (banError) throw banError

    // Mirrors the ban onto profiles.account_status so the console can show
    // status without a second auth-admin round trip. The DB trigger from
    // 0065 only allows this column to change via a platform admin (checked
    // above) or a service-role caller (this one) -- never by the user
    // themselves.
    const { error: statusError } = await admin
      .from('profiles')
      .update({ account_status: blocked ? 'blocked' : 'active' })
      .eq('id', userId)
    if (statusError) throw statusError

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('admin/set-user-blocked error:', err)
    res.status(500).json({ error: err.message || 'Failed to update user status.' })
  }
}
