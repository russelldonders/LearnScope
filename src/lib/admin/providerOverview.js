import { supabase } from '../supabaseClient'

// Count-only queries for the provider console's own Overview/work-queue tab
// -- same { count: 'exact', head: true } shape as admin/overview.js's
// countRows, just scoped to a single organisation_id rather than the whole
// platform, since a provider only ever gets to see/act on their own org's
// rows (RLS: "Platform admins and org members can view organisation
// members" (0065), "View own org's resources..." (0073) -- both already
// grant a plain org member, not just an org admin, select access to the
// rows counted here).
async function countOrgRows(table, column, value, organisationId) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', organisationId)
    .eq(column, value)
  if (error) throw error
  return count ?? 0
}

// course_catalogue is versioned (0107): every version shares one
// version_group_id, and create_course_draft_version's own existence check
// guarantees at most one row per group is ever in ('draft',
// 'pending_approval', 'rejected') at a time -- so a plain per-status count
// here already matches what ProviderTrainingSection's deduped (one row per
// group) list would show, with no need to fetch full rows and dedupe
// client-side just to size a tile.
export function countDraftCourses(organisationId) {
  return countOrgRows('course_catalogue', 'status', 'draft', organisationId)
}

export function countRejectedCourses(organisationId) {
  return countOrgRows('course_catalogue', 'status', 'rejected', organisationId)
}

export function countPendingApprovalCourses(organisationId) {
  return countOrgRows('course_catalogue', 'status', 'pending_approval', organisationId)
}

// organisation_members.status is 'pending' | 'active' (0070), same as
// admin/overview.js's countPendingStaffInvitations, just scoped to one org
// here instead of every provider organisation on the platform.
export function countPendingStaffInvitations(organisationId) {
  return countOrgRows('organisation_members', 'status', 'pending', organisationId)
}

// content_resources.status is 'draft' | 'published' | 'inactive'
// (20260831130759) -- a draft resource is genuinely unpublished work in
// this data model, unlike a provider catalogue's own "no publications yet"
// state, which has no single indexed column to count against and would
// need a NOT EXISTS join rather than a plain .eq() count.
export function countDraftResources(organisationId) {
  return countOrgRows('content_resources', 'status', 'draft', organisationId)
}
