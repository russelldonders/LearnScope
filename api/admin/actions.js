import { verifySupabaseUser } from '../_lib/auth.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { deleteUserEvidenceFiles } from '../_lib/evidenceStorage.js'

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
      case 'getUserLinkages':
        await getUserLinkages(admin, caller, payload, res)
        return
      case 'getUserProfile':
        await getUserProfile(admin, caller, payload, res)
        return
      case 'deleteUser':
        await deleteUser(admin, caller, payload, res)
        return
      case 'inviteOrgStaff':
        await inviteOrgStaff(admin, caller, payload, res)
        return
      case 'listOrgMembers':
        await listOrgMembers(admin, caller, payload, res)
        return
      default:
        res.status(400).json({ error: 'Unknown action' })
    }
  } catch (err) {
    console.error(`admin/actions (${action}) error:`, err)
    res.status(500).json({ error: err.message || 'Request failed.' })
  }
}

// GoTrue reports the total page count on the first page's response (via a
// Link header supabase-js parses into `lastPage`), so the remaining pages
// can be fetched together instead of one-at-a-time -- turns what was N
// sequential round-trips into effectively 2. Falls back to the old
// one-page-at-a-time loop only if that header is ever missing despite a
// full first page, since then the true page count isn't known upfront.
async function listAllAuthUsers(admin) {
  const { data: firstPage, error: firstPageError } = await admin.auth.admin.listUsers({ page: 1, perPage: PER_PAGE })
  if (firstPageError) throw firstPageError

  const users = [...firstPage.users]
  if (firstPage.users.length < PER_PAGE) return users

  if (firstPage.lastPage > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: firstPage.lastPage - 1 }, (_, i) => admin.auth.admin.listUsers({ page: i + 2, perPage: PER_PAGE }))
    )
    for (const { data, error } of remainingPages) {
      if (error) throw error
      users.push(...data.users)
    }
    return users
  }

  let page = 2
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < PER_PAGE) break
    page += 1
  }
  return users
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

  // The four reads below are all independent of each other and of the auth
  // user list -- fire them together instead of one-at-a-time so total
  // latency is the slowest of the five, not the sum of all five.
  const [users, profilesResult, adminRowsResult, orgMemberRowsResult, orgsResult] = await Promise.all([
    listAllAuthUsers(admin),
    admin.from('profiles').select('id, full_name, account_status'),
    admin.from('platform_admins').select('user_id'),
    // Active org memberships only -- a 'pending' row (0070) isn't a real role
    // yet, the invite just hasn't been accepted, so it shouldn't read as one
    // in a list that's meant to show what access someone actually has.
    admin.from('organisation_members').select('user_id, organisation_id, role').eq('status', 'active'),
    admin.from('organisations').select('id, name'),
  ])

  const { data: profiles, error: profilesError } = profilesResult
  if (profilesError) throw profilesError
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  const { data: adminRows, error: adminRowsError } = adminRowsResult
  if (adminRowsError) throw adminRowsError
  const adminIds = new Set(adminRows.map((r) => r.user_id))

  const { data: orgMemberRows, error: orgMemberRowsError } = orgMemberRowsResult
  if (orgMemberRowsError) throw orgMemberRowsError

  const { data: orgs, error: orgsError } = orgsResult
  if (orgsError) throw orgsError
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]))

  const orgMembershipsByUser = new Map()
  for (const m of orgMemberRows) {
    const list = orgMembershipsByUser.get(m.user_id) ?? []
    list.push({ organisationName: orgNameById.get(m.organisation_id) ?? 'Unknown organisation', role: m.role })
    orgMembershipsByUser.set(m.user_id, list)
  }

  const result = users.map((u) => {
    const profile = profileById.get(u.id)
    return {
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      fullName: profile?.full_name ?? null,
      accountStatus: profile?.account_status ?? 'active',
      organisationMemberships: orgMembershipsByUser.get(u.id) ?? [],
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

// Counts what a hard delete would take with it, so the console can warn the
// admin before they confirm -- mirrors the categories the self-service
// "Delete account" flow on Profile.jsx already warns about (skills, courses,
// experience, connections), plus the two things unique to an admin deleting
// someone *else's* account: which organisations they'd lose access to, and
// whether they're the platform's last remaining admin.
async function getUserLinkages(admin, caller, { userId }, res) {
  if (!userId) {
    res.status(400).json({ error: 'Missing userId' })
    return
  }

  if (!(await isPlatformAdmin(admin, caller.id))) {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }

  const { count: skillsCount, error: skillsError } = await admin
    .from('skills')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (skillsError) throw skillsError

  const { count: coursesCount, error: coursesError } = await admin
    .from('courses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (coursesError) throw coursesError

  const { count: experienceCount, error: experienceError } = await admin
    .from('experience')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (experienceError) throw experienceError

  const { count: connectionsAsA, error: connectionsAError } = await admin
    .from('connections')
    .select('id', { count: 'exact', head: true })
    .eq('user_a_id', userId)
  if (connectionsAError) throw connectionsAError

  const { count: connectionsAsB, error: connectionsBError } = await admin
    .from('connections')
    .select('id', { count: 'exact', head: true })
    .eq('user_b_id', userId)
  if (connectionsBError) throw connectionsBError

  const { data: orgMemberRows, error: orgMemberError } = await admin
    .from('organisation_members')
    .select('organisation_id, role')
    .eq('user_id', userId)
  if (orgMemberError) throw orgMemberError

  let organisations = []
  if (orgMemberRows.length > 0) {
    const { data: orgRows, error: orgError } = await admin
      .from('organisations')
      .select('id, name')
      .in('id', orgMemberRows.map((m) => m.organisation_id))
    if (orgError) throw orgError
    const nameById = new Map(orgRows.map((o) => [o.id, o.name]))
    organisations = orgMemberRows.map((m) => ({ name: nameById.get(m.organisation_id) ?? 'Unknown organisation', role: m.role }))
  }

  const { data: targetAdminRow, error: targetAdminError } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (targetAdminError) throw targetAdminError

  let isLastPlatformAdmin = false
  if (targetAdminRow) {
    const { data: allAdmins, error: allAdminsError } = await admin.from('platform_admins').select('user_id')
    if (allAdminsError) throw allAdminsError
    isLastPlatformAdmin = allAdmins.length <= 1
  }

  res.status(200).json({
    counts: {
      skills: skillsCount ?? 0,
      courses: coursesCount ?? 0,
      experience: experienceCount ?? 0,
      connections: (connectionsAsA ?? 0) + (connectionsAsB ?? 0),
    },
    organisations,
    isPlatformAdmin: Boolean(targetAdminRow),
    isLastPlatformAdmin,
  })
}

// Full read-only dossier for the platform console's user detail page --
// everything getUserLinkages above only counts, spelled out, plus platform
// admin status and org roles including pending (not just active) ones so an
// admin investigating an account can see an invite still awaiting
// acceptance. Deliberately service-role/RLS-bypassing (like every other
// action in this file) rather than a client-side query modeled on
// SkillsProfile.jsx, since that page only shows what the *viewed* user has
// opted into sharing -- a platform admin needs to see the whole record
// regardless of the learner's own visibility toggles.
async function getUserProfile(admin, caller, { userId }, res) {
  if (!userId) {
    res.status(400).json({ error: 'Missing userId' })
    return
  }

  if (!(await isPlatformAdmin(admin, caller.id))) {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }

  const { data: targetUser, error: targetUserError } = await admin.auth.admin.getUserById(userId)
  if (targetUserError || !targetUser?.user) {
    res.status(404).json({ error: 'User not found.' })
    return
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('first_name, last_name, account_status, country, location, language, avatar_url')
    .eq('id', userId)
    .maybeSingle()
  if (profileError) throw profileError

  const { data: skills, error: skillsError } = await admin
    .from('skills')
    .select('id, name, category, level')
    .eq('user_id', userId)
    .order('name')
  if (skillsError) throw skillsError

  const { data: courses, error: coursesError } = await admin
    .from('courses')
    .select('id, name, provider, completed_date')
    .eq('user_id', userId)
    .order('completed_date', { ascending: false })
  if (coursesError) throw coursesError

  const { data: experience, error: experienceError } = await admin
    .from('experience')
    .select('id, type, title, organization, start_date, end_date')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
  if (experienceError) throw experienceError

  const { data: connectionRows, error: connectionsError } = await admin
    .from('connections')
    .select('id, user_a_id, user_b_id')
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
  if (connectionsError) throw connectionsError

  const counterpartIds = connectionRows.map((c) => (c.user_a_id === userId ? c.user_b_id : c.user_a_id))
  let connections = []
  if (counterpartIds.length > 0) {
    const { data: counterpartProfiles, error: counterpartError } = await admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', counterpartIds)
    if (counterpartError) throw counterpartError
    const profileById = new Map(counterpartProfiles.map((p) => [p.id, p]))
    connections = counterpartIds.map((id) => {
      const p = profileById.get(id)
      const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ')
      return { id, name: name || null }
    })
  }

  const { data: orgMemberRows, error: orgMemberError } = await admin
    .from('organisation_members')
    .select('organisation_id, role, status')
    .eq('user_id', userId)
  if (orgMemberError) throw orgMemberError

  let organisationMemberships = []
  if (orgMemberRows.length > 0) {
    const { data: orgRows, error: orgError } = await admin
      .from('organisations')
      .select('id, name')
      .in('id', orgMemberRows.map((m) => m.organisation_id))
    if (orgError) throw orgError
    const nameById = new Map(orgRows.map((o) => [o.id, o.name]))
    organisationMemberships = orgMemberRows.map((m) => ({
      organisationName: nameById.get(m.organisation_id) ?? 'Unknown organisation',
      role: m.role,
      status: m.status,
    }))
  }

  const { data: targetAdminRow, error: targetAdminError } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (targetAdminError) throw targetAdminError

  res.status(200).json({
    profile: {
      id: userId,
      email: targetUser.user.email,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      accountStatus: profile?.account_status ?? 'active',
      country: profile?.country ?? null,
      location: profile?.location ?? null,
      language: profile?.language ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      createdAt: targetUser.user.created_at,
      lastSignInAt: targetUser.user.last_sign_in_at ?? null,
    },
    isPlatformAdmin: Boolean(targetAdminRow),
    organisationMemberships,
    skills,
    courses,
    experience,
    connections,
  })
}

// Hard delete -- irreversible, unlike setUserBlocked above. The client is
// required to have shown the admin the getUserLinkages summary and gotten
// an explicit typed confirmation first (AdminUsers.jsx's DeleteUserDialog),
// but this re-checks the two things that must never happen regardless of
// what the client did: deleting your own account this way, or removing the
// platform's last admin.
async function deleteUser(admin, caller, { userId }, res) {
  if (!userId) {
    res.status(400).json({ error: 'Missing userId' })
    return
  }

  if (!(await isPlatformAdmin(admin, caller.id))) {
    res.status(403).json({ error: 'Platform admin access required' })
    return
  }

  if (userId === caller.id) {
    res.status(400).json({ error: "You can't delete your own account from here." })
    return
  }

  // Confirms userId is a real account before running any scrub steps below --
  // otherwise a typo'd/stale id would silently no-op every scrub update
  // (0 rows matched) and only fail later at auth.admin.deleteUser(), which
  // would then misleadingly log as a "PARTIAL FAILURE" despite nothing
  // having actually been scrubbed.
  const { data: targetUser, error: targetUserError } = await admin.auth.admin.getUserById(userId)
  if (targetUserError || !targetUser?.user) {
    res.status(404).json({ error: 'User not found.' })
    return
  }

  const { data: targetAdminRow, error: targetAdminError } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (targetAdminError) throw targetAdminError

  if (targetAdminRow) {
    const { data: allAdmins, error: allAdminsError } = await admin.from('platform_admins').select('user_id')
    if (allAdminsError) throw allAdminsError
    if (allAdmins.length <= 1) {
      res.status(400).json({ error: 'Cannot delete the last remaining platform admin.' })
      return
    }
  }

  // Same scrub as delete_own_account_scrub (0064), targeting an admin-chosen
  // user instead of auth.uid() -- safe to do with plain service-role calls
  // here (rather than that migration's SECURITY DEFINER RPC) since this
  // handler has already independently verified the caller's authority above.
  const { error: ratingScrubError } = await admin
    .from('skill_peer_ratings')
    .update({ rater_name: null, rater_email: null })
    .eq('rater_id', userId)
  if (ratingScrubError) throw ratingScrubError

  const { error: validationScrubError } = await admin
    .from('skill_validation_requests')
    .update({
      status: 'declined',
      decided_at: new Date().toISOString(),
      decision_comments: 'Validator account was deleted.',
    })
    .eq('validator_id', userId)
    .eq('status', 'pending')
  if (validationScrubError) throw validationScrubError

  const { error: privateLibraryError } = await admin
    .from('skill_library')
    .delete()
    .eq('created_by', userId)
    .eq('is_private', true)
  if (privateLibraryError) throw privateLibraryError

  // From here on, the scrub above has already committed. If anything below
  // fails, the account survives but that scrub can't be undone -- log it
  // distinctly so a partial failure doesn't read the same as an ordinary one.
  try {
    await deleteUserEvidenceFiles(admin, userId)

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
    if (deleteError) throw deleteError
  } catch (err) {
    console.error(`admin deleteUser PARTIAL FAILURE for user ${userId}: scrub already committed, account NOT deleted -`, err)
    res.status(500).json({ error: 'Failed to delete account.' })
    return
  }

  res.status(200).json({ ok: true })
}

// Platform admin, or an 'admin' member of this specific organisation --
// never trust the client's claim about who they are. Shared by every
// org-scoped action below; sends the 403 itself so callers can just
// `if (!(await requireOrgAdmin(...))) return`.
async function requireOrgAdmin(admin, caller, organisationId, res) {
  if (await isPlatformAdmin(admin, caller.id)) return true
  const { data: memberRow, error: memberCheckError } = await admin
    .from('organisation_members')
    .select('role')
    .eq('organisation_id', organisationId)
    .eq('user_id', caller.id)
    .maybeSingle()
  if (memberCheckError) throw memberCheckError
  if (!memberRow || memberRow.role !== 'admin') {
    res.status(403).json({ error: 'Organisation admin access required' })
    return false
  }
  return true
}

async function inviteOrgStaff(admin, caller, { organisationId, email, role }, res) {
  if (!organisationId || !email || !VALID_ORG_ROLES.includes(role)) {
    res.status(400).json({ error: 'Missing or invalid organisationId, email, or role' })
    return
  }

  if (!(await requireOrgAdmin(admin, caller, organisationId, res))) return

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
      res.status(409).json({ error: 'This person is already a user (or already invited) at this organisation.' })
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

// organisation_members only stores user_id -- profiles has no email column
// (same reasoning as listUsers() above), so the staff list needs a
// service-role lookup to show something more useful than a raw uuid.
async function listOrgMembers(admin, caller, { organisationId }, res) {
  if (!organisationId) {
    res.status(400).json({ error: 'Missing organisationId' })
    return
  }

  if (!(await requireOrgAdmin(admin, caller, organisationId, res))) return

  const { data: members, error: membersError } = await admin
    .from('organisation_members')
    .select('id, user_id, role, status, created_at')
    .eq('organisation_id', organisationId)
    .order('created_at')
  if (membersError) throw membersError

  const details = await Promise.all(
    members.map(async (m) => {
      const { data, error } = await admin.auth.admin.getUserById(m.user_id)
      return { ...m, email: error ? null : (data?.user?.email ?? null) }
    })
  )

  res.status(200).json({ members: details })
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
        subject: `${orgName} wants to add you on LearnScope`,
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
