import { verifySupabaseUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

// Single dispatcher for every platform-admin/org-admin service-role action,
// rather than one serverless function per action -- Vercel's Hobby plan
// caps deployments at 12 serverless functions, and this project was
// already at that cap before the admin console existed. Each action below
// re-verifies the caller's authority server-side exactly as its own
// function would have, since this route uses the service-role key and
// bypasses RLS entirely.

const PER_PAGE = 200
const VALID_ORG_ROLES = ['admin', 'trainer']

// Without an explicit redirectTo, Supabase Auth falls back to the project's
// dashboard-configured Site URL for invite emails -- fine for the
// client-side auth flows in AuthContext.jsx (they all pass
// window.location.origin explicitly), but this runs server-side with no
// window. APP_URL must be set in Vercel per environment (Preview/Staging
// vs Production) and the resulting URL added to the Supabase project's
// Redirect URLs allow-list, or Supabase silently falls back to Site URL
// anyway. No fallback URL guess here -- an unset APP_URL should surface as
// a real Site-URL-configured link (however it's currently set) rather than
// silently degrade to something possibly wrong.
function inviteRedirectTo() {
  return process.env.APP_URL ? { redirectTo: `${process.env.APP_URL}/reset-password` } : undefined
}

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

  const { action, ...payload } = req.body ?? {}

  try {
    const admin = supabaseAdmin()
    switch (action) {
      case 'listUsers':
        await listUsers(admin, caller, res)
        return
      case 'inviteUser':
        await inviteUser(admin, caller, payload, res)
        return
      case 'setUserBlocked':
        await setUserBlocked(admin, caller, payload, res)
        return
      case 'inviteOrgStaff':
        await inviteOrgStaff(admin, caller, payload, res)
        return
      default:
        res.status(400).json({ error: 'Unknown action' })
    }
  } catch (err) {
    console.error(`admin/actions (${action}) error:`, err)
    res.status(500).json({ error: err.message || 'Request failed.' })
  }
}

async function isPlatformAdmin(admin, userId) {
  const { data, error } = await admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

// profiles has no email column (email lives on auth.users only), and the
// client can't call auth.admin.listUsers itself -- so this listing has to
// happen server-side either way. Doing the profiles/platform_admins join
// here too, rather than adding a client-facing "platform admins can read
// every profile" RLS policy, keeps that broader read grant out of the
// standing permission model entirely.
async function listUsers(admin, caller, res) {
  if (!(await isPlatformAdmin(admin, caller.id))) {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }

  let page = 1
  const users = []
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < PER_PAGE) break
    page += 1
  }

  const { data: profiles, error: profilesError } = await admin.from('profiles').select('id, full_name, account_status')
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
}

async function inviteUser(admin, caller, { email, grantPlatformAdmin }, res) {
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Missing email' })
    return
  }

  if (!(await isPlatformAdmin(admin, caller.id))) {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim(), inviteRedirectTo())
  if (inviteError) throw inviteError

  if (grantPlatformAdmin) {
    const { error: grantError } = await admin
      .from('platform_admins')
      .insert({ user_id: invited.user.id, granted_by: caller.id })
    if (grantError) throw grantError
  }

  res.status(200).json({ ok: true, userId: invited.user.id })
}

async function setUserBlocked(admin, caller, { userId, blocked }, res) {
  if (!userId || typeof blocked !== 'boolean') {
    res.status(400).json({ error: 'Missing userId or blocked' })
    return
  }

  if (!(await isPlatformAdmin(admin, caller.id))) {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }

  if (blocked && userId === caller.id) {
    res.status(400).json({ error: "You can't block your own account." })
    return
  }

  // If the target is a platform admin, blocking them must not leave the
  // console with no one left who can un-block anyone -- check whether any
  // other platform admin is still unblocked before proceeding.
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
}

async function inviteOrgStaff(admin, caller, { organisationId, email, role }, res) {
  if (!organisationId || !email || !VALID_ORG_ROLES.includes(role)) {
    res.status(400).json({ error: 'Missing or invalid organisationId, email, or role' })
    return
  }

  // Re-derive the caller's authority server-side -- platform admin, or an
  // 'admin' member of this specific organisation -- never trust the
  // client's claim about who they are.
  if (!(await isPlatformAdmin(admin, caller.id))) {
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

  // An existing LearnScope user (they signed up themselves, or already
  // belongs to another organisation) shouldn't get a "create your account"
  // invite email and shouldn't error the whole action -- inviteUserByEmail
  // only makes sense for someone with no account yet. But they also haven't
  // agreed to anything, so unlike a brand-new invite (where clicking the
  // Supabase invite-email link *is* the consent step), this inserts as
  // 'pending' -- is_org_admin/is_org_member (0070) don't grant access for a
  // pending row, so nothing changes for this org until the invited user
  // explicitly accepts via decide_org_invite, surfaced to them on
  // /connections (see PendingActionsContext, listMyPendingOrgInvites).
  const existingUserId = await findUserIdByEmail(admin, email.trim())
  let userId = existingUserId
  if (!userId) {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email.trim(), inviteRedirectTo())
    if (inviteError) throw inviteError
    userId = invited.user.id
  }

  const { error: memberInsertError } = await admin.from('organisation_members').insert({
    organisation_id: organisationId,
    user_id: userId,
    role,
    invited_by: caller.id,
    ...(existingUserId ? { status: 'pending' } : {}),
  })
  if (memberInsertError) {
    // unique_violation on (organisation_id, user_id) -- they're already
    // staff (or already have a pending invite) here, surface that plainly
    // rather than a raw constraint error.
    if (memberInsertError.code === '23505') {
      res.status(409).json({ error: 'This person is already staff (or already invited) at this organisation.' })
      return
    }
    throw memberInsertError
  }

  // An existing user gets no Supabase invite email (there's nothing to
  // accept there -- they already have an account), so this is the only
  // signal they get that an org wants to add them as staff. Best-effort: a
  // failed notification shouldn't undo the pending row that already
  // succeeded above -- they can still find and accept/decline it from
  // /connections without ever seeing this email.
  if (existingUserId) {
    await notifyOrgInvitePending(admin, email.trim(), organisationId, role)
  }

  res.status(200).json({ ok: true, userId, alreadyExisted: Boolean(existingUserId) })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

async function notifyOrgInvitePending(admin, email, organisationId, role) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return

  const { data: org } = await admin.from('organisations').select('name').eq('id', organisationId).maybeSingle()
  const orgName = org?.name || 'a provider organisation'
  const roleLabel = role === 'admin' ? 'an admin' : 'a trainer'

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'LearnScope <onboarding@resend.dev>',
        to: email,
        subject: `${orgName} wants to add you as staff on LearnScope`,
        html: `
          <p><strong>${escapeHtml(orgName)}</strong> wants to add you as ${roleLabel} on LearnScope.</p>
          <p>Sign in to your existing account and check your Connections page to accept or decline.</p>
        `,
      }),
    })
    if (!resendRes.ok) {
      const detail = await resendRes.text()
      console.error('notifyOrgInvitePending: Resend error', resendRes.status, detail)
    }
  } catch (err) {
    console.error('Failed to send org-invite-pending notification email:', err)
  }
}

// Same manual-pagination pattern as listUsers() above -- profiles has no
// email column (email lives on auth.users only), and this project doesn't
// otherwise rely on GoTrue's admin listUsers accepting an email filter, so
// stay consistent with the one lookup pattern already used here.
async function findUserIdByEmail(admin, email) {
  const target = email.toLowerCase()
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw error
    const match = data.users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match.id
    if (data.users.length < PER_PAGE) return null
    page += 1
  }
}
