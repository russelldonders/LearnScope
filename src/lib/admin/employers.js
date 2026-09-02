import { supabase } from '../supabaseClient'
import { callAdminApi } from './adminApi'
import { listPublishedProviderCourses } from './providerCatalogues'

// Mirrors src/lib/admin/organisations.js's shape/conventions. employers'
// RLS select policy (is_employer_member, unlike organisations' open
// "any authenticated user can view") already scopes a direct client query
// correctly for both audiences: a platform admin sees every row (the
// is_platform_admin bypass baked into is_employer_member), and an
// employer's own admin sees only their own employer(s) -- no service-role
// round trip needed for either.
export async function listEmployers() {
  const { data, error } = await supabase.from('employers').select('*').order('name')
  if (error) throw error
  return data ?? []
}

export async function getEmployer(id) {
  const { data, error } = await supabase.from('employers').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

// create_employer (20260902090000) is security definer and platform-admin-
// gated internally -- creates the employer's attached provider organisation
// and the employer row together, atomically, so the two can never be
// created out of step with each other.
export async function createEmployer(name) {
  const { data, error } = await supabase.rpc('create_employer', { p_name: name.trim() })
  if (error) throw error
  return data
}

// employer_members only stores user_id -- profiles has no email column
// (same reasoning as organisation_members' listOrganisationMembers), so the
// roster needs the service-role dispatcher to show something more useful
// than a raw uuid.
export async function listEmployerMembers(employerId) {
  const { members } = await callAdminApi('listEmployerMembers', { employerId })
  return members ?? []
}

// Phase 2: proper invite semantics, mirroring inviteOrganisationStaff --
// supports both an existing LearnScope user (lands 'pending', needs their
// consent via decideEmployerInvite below) and a brand-new one (gets an auth
// invite email, lands 'active' immediately). Response is
// { ok, userId, alreadyExisted } -- alreadyExisted distinguishes "invited a
// new account" from "added an existing user, pending their acceptance".
export async function addEmployerMember(employerId, email, role) {
  return callAdminApi('addEmployerMember', { employerId, email, role })
}

export async function removeEmployerMember(memberRowId) {
  const { error } = await supabase.from('employer_members').delete().eq('id', memberRowId)
  if (error) throw error
}

// Pending employer_members rows addressed to the current user -- an
// employer admin invited them, and they haven't accepted or declined yet.
// Mirrors listMyPendingOrgInvites (src/lib/organisationInvites.js) exactly,
// joined to employers instead of organisations. Kept in this file (rather
// than a separate employerInvites.js) since every other employer-domain
// client function already lives here.
export async function listMyPendingEmployerInvites(userId) {
  const { data, error } = await supabase
    .from('employer_members')
    .select('id, role, created_at, employers(id, name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Mirrors decideOrgInvite -- decide_employer_invite (20260902160000) is
// security definer, runs as the invited user, and (for an accepted 'admin'
// invite) also grants the matching organisation_members admin row on the
// employer's attached provider organisation.
export async function decideEmployerInvite(memberId, accept) {
  const { error } = await supabase.rpc('decide_employer_invite', { p_member_id: memberId, p_accept: accept })
  if (error) throw error
}

// Phase 3: course assignment ("push training" rather than 100%
// learner-initiated browse/enrol -- courseCatalogue.js's
// listCatalogueCourses/enrolInCatalogueCourse are untouched by this phase).
//
// Reuses listPublishedProviderCourses (providerCatalogues.js) as-is rather
// than writing a new query -- it already lists an organisation's own
// approved + currently-published course_catalogue rows, the same picker
// source ProviderCataloguesSection uses for "assign to catalogue". The RPC
// below is the actual authority on eligibility (published in one of this
// employer's own catalogues specifically, not just authored by the org) --
// this is only the convenience list for the picker UI.
export async function listEmployerCatalogueCourses(providerOrganisationId) {
  return listPublishedProviderCourses(providerOrganisationId)
}

// assign_course_to_employer_members (20260902180000) is security definer:
// validates the caller's admin status and the course's catalogue
// eligibility server-side, then inserts one course_assignments row per
// requested user who is actually an active member of this employer,
// skipping anyone already assigned (on conflict do nothing). Returns only
// the rows that were actually newly inserted -- callers should compare
// against the requested userIds to report any that were silently skipped
// (not an active member, or already assigned) rather than claiming a
// uniform success.
export async function assignCourseToEmployerMembers(employerId, catalogueCourseId, userIds) {
  const { data, error } = await supabase.rpc('assign_course_to_employer_members', {
    p_employer_id: employerId,
    p_catalogue_course_id: catalogueCourseId,
    p_user_ids: userIds,
  })
  if (error) throw error
  return data ?? []
}

// Admin-side roster/status view: every assignment this employer has made,
// whatever its status (assigned/enrolled/dismissed), joined to the course's
// own name/details. Doesn't resolve the assigned learner's email -- callers
// already have that from listEmployerMembers (keyed by user_id) and cross-
// reference it themselves, rather than this duplicating that service-role
// lookup.
export async function listEmployerCourseAssignments(employerId) {
  const { data, error } = await supabase
    .from('course_assignments')
    .select('id, catalogue_course_id, assigned_to, assigned_by, status, created_at, course_catalogue(id, name)')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
