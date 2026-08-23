import { verifySupabaseUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

const PER_PAGE = 200

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

    // profiles has no email column (email lives on auth.users only), and
    // the client can't call auth.admin.listUsers itself -- so this listing
    // has to happen server-side either way. Doing the profiles/platform_admins
    // join here too, rather than adding a client-facing "platform admins can
    // read every profile" RLS policy, keeps that broader read grant out of
    // the standing permission model entirely.
    let page = 1
    const users = []
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
      if (error) throw error
      users.push(...data.users)
      if (data.users.length < PER_PAGE) break
      page += 1
    }

    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, full_name, account_status')
    if (profilesError) throw profilesError
    const profileById = new Map(profiles.map((p) => [p.id, p]))

    const { data: adminRows, error: adminRowsError } = await admin.from('platform_admins').select('user_id')
    if (adminRowsError) throw adminRowsError
    const adminIds = new Set(adminRows.map((r) => r.user_id))

    const result = users.map((u) => {
      const profile = profileById.get(u.id)
      return {
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        fullName: profile?.full_name ?? null,
        accountStatus: profile?.account_status ?? 'active',
        isPlatformAdmin: adminIds.has(u.id),
      }
    })

    res.status(200).json({ users: result })
  } catch (err) {
    console.error('admin/list-users error:', err)
    res.status(500).json({ error: err.message || 'Failed to list users.' })
  }
}
