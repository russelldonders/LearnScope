import { supabase } from '../supabaseClient'

// Count-only queries for the platform-admin Overview/work-queue page --
// { count: 'exact', head: true } mirrors Dashboard.jsx's countRows so these
// never pull full row sets just to size a tile. Each is a single .eq() count
// against a table platform admins already have RLS select access to
// directly (course_catalogue, profiles, organisations, organisation_members
// all already support this from other admin pages/policies -- see
// AdminCatalogue.jsx/AdminUsers.jsx's accountStatus column and 0065/0070's
// "platform admins bypass is_org_member" RLS), so none of this needs the
// service-role callAdminApi dispatcher AdminUsers.jsx's user list uses.
async function countRows(table, column, value) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
  if (error) throw error
  return count ?? 0
}

export function countPendingCourseApprovals() {
  return countRows('course_catalogue', 'status', 'pending_approval')
}

export function countRejectedCourses() {
  return countRows('course_catalogue', 'status', 'rejected')
}

export function countBlockedUsers() {
  return countRows('profiles', 'account_status', 'blocked')
}

// organisations.status is 'active' | 'inactive' (0065) -- there is no
// separate 'suspended' value in this schema.
export function countInactiveProviders() {
  return countRows('organisations', 'status', 'inactive')
}

// organisation_members.status is 'pending' | 'active' (0070) -- a platform
// admin's RLS select on this table isn't scoped to one organisation_id
// (is_org_member() short-circuits true for is_platform_admin), so this counts
// pending invites across every provider organisation in one query rather
// than looping per-org the way OrganisationStaffPanel's member listing does
// (that loop is only needed there for the email lookup, which requires the
// service-role listOrgMembers call -- a plain count doesn't).
export function countPendingStaffInvitations() {
  return countRows('organisation_members', 'status', 'pending')
}

// Optional recency signal (CLAUDE.md/plan: no new activity-log table this
// slice) -- reuses course_catalogue.created_at, the same column
// listAllCatalogueCourses() already orders by.
export async function countRecentCourseSubmissions(days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('course_catalogue')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}
