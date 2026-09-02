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

// Phase 5: explicit, learner-controlled consent for an employer admin to see
// a member's skills profile beyond whatever the employer's own training
// already exposes automatically (is_course_provider_admin, 0105 -- untouched
// by this phase). request_employer_data_access (20260902200000) is security
// definer: checks the caller is an admin of p_employerId and that
// p_learnerId is an active member of it, then upserts the (employer, learner)
// row -- idempotent for an existing pending/approved row, resets a declined/
// revoked one back to pending.
export async function requestEmployerDataAccess(employerId, learnerId) {
  const { data, error } = await supabase.rpc('request_employer_data_access', {
    p_employer_id: employerId,
    p_learner_id: learnerId,
  })
  if (error) throw error
  return data
}

// Mirrors decideEmployerInvite's shape -- decide_employer_data_access_request
// (20260902200000, refined 20260902220000) is security definer, runs as the
// learner being asked, checked against auth.uid() and the row's 'pending'
// status server-side. skillIds is only meaningful when accepting -- it
// replaces the request's shared-skill set (employer_data_access_shared_
// skills), validated server-side to actually belong to the caller.
export async function decideEmployerDataAccessRequest(requestId, accept, skillIds = []) {
  const { error } = await supabase.rpc('decide_employer_data_access_request', {
    p_request_id: requestId,
    p_accept: accept,
    p_skill_ids: skillIds,
  })
  if (error) throw error
}

// Learner-initiated proactive share, no request needed -- caller must
// already be an active member of the employer they're sharing with
// (share_data_with_employer checks this server-side). skillIds is the set
// of skills actually shared, replacing whatever set (if any) existed before.
export async function shareDataWithEmployer(employerId, skillIds = []) {
  const { data, error } = await supabase.rpc('share_data_with_employer', {
    p_employer_id: employerId,
    p_skill_ids: skillIds,
  })
  if (error) throw error
  return data
}

// Lets a learner change which skills are shared with an already-approved
// employer without revoking and re-sharing from scratch. update_shared_
// employer_skills (20260902220000) only permits editing a live ('approved')
// grant, and re-validates skill ownership server-side same as the above two.
export async function updateSharedEmployerSkills(requestId, skillIds) {
  const { error } = await supabase.rpc('update_shared_employer_skills', {
    p_request_id: requestId,
    p_skill_ids: skillIds,
  })
  if (error) throw error
}

// The current shared-skill set for a request -- used to pre-fill the share
// picker when editing an existing approved grant, and to show a per-employer
// summary of what's currently visible to them (ProfilePrivacy.jsx). Relies
// on employer_data_access_shared_skills' own select policy (visible to the
// learner or the employer's admins) rather than a dedicated RPC, since this
// is read-only.
export async function listSharedEmployerSkillIds(requestId) {
  const { data, error } = await supabase
    .from('employer_data_access_shared_skills')
    .select('skill_id')
    .eq('request_id', requestId)
  if (error) throw error
  return (data ?? []).map((row) => row.skill_id)
}

// Learner revokes a live grant (from either an accepted request or a
// proactive share) at any time.
export async function revokeEmployerDataAccess(requestId) {
  const { error } = await supabase.rpc('revoke_employer_data_access', { p_request_id: requestId })
  if (error) throw error
}

// Admin-side roster/status view: every data access row this employer has,
// whatever its status -- mirrors listEmployerCourseAssignments's shape (a
// direct scoped table query, relying on the employer-admin SELECT policy on
// employer_data_access_requests rather than a dedicated RPC, since this is
// read-only). Doesn't resolve the learner's email -- callers already have
// that from listEmployerMembers (keyed by user_id).
export async function listEmployerDataAccessRequests(employerId) {
  const { data, error } = await supabase
    .from('employer_data_access_requests')
    .select('id, learner_id, status, requested_by, created_at, decided_at')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Pending data access requests addressed to the current learner -- an
// employer admin asked, and they haven't accepted or declined yet. Mirrors
// listMyPendingEmployerInvites exactly, joined to employers instead.
export async function listMyPendingDataAccessRequests(userId) {
  const { data, error } = await supabase
    .from('employer_data_access_requests')
    .select('id, employer_id, created_at, employers(id, name)')
    .eq('learner_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Every one of the current user's data access rows, whatever their status --
// for ProfilePrivacy.jsx's "here's your sharing status with each employer
// you belong to" view. Employers with no row at all (never requested or
// shared) simply won't appear here; callers cross-reference against the
// learner's active employer memberships to show those too.
export async function listMyEmployerDataAccessStatus(userId) {
  const { data, error } = await supabase
    .from('employer_data_access_requests')
    .select('id, employer_id, status, requested_by, created_at, decided_at, employers(id, name)')
    .eq('learner_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Phase 6: employer-side skill suggestion, mirroring Phase 3's course
// assignment "push, don't force" pattern exactly. suggest_skill_to_
// employer_members (20260902230000) is security definer: validates the
// caller's admin status server-side, then inserts one employer_skill_
// suggestions row per requested user who is actually an active member of
// this employer, skipping anyone already suggested this skill (unless
// their prior suggestion was dismissed, which gets reset to a fresh one).
// It never creates or modifies the learner's own skills/skill_targets rows
// -- that only happens via the learner's own explicit "Add to my skills"
// action (adoptSkillSuggestion, src/lib/skillSuggestions.js). Returns only
// the rows that were actually newly inserted/reset -- callers should
// compare against the requested userIds to report any that were silently
// skipped (not an active member, or already suggested/adopted) rather than
// claiming a uniform success.
export async function suggestSkillToEmployerMembers(
  employerId,
  skillLibraryId,
  skillName,
  userIds,
  { targetLevel = null, targetDate = null, comments = null } = {}
) {
  const { data, error } = await supabase.rpc('suggest_skill_to_employer_members', {
    p_employer_id: employerId,
    p_skill_library_id: skillLibraryId,
    p_skill_name: skillName,
    p_user_ids: userIds,
    p_target_level: targetLevel,
    p_target_date: targetDate,
    p_comments: comments,
  })
  if (error) throw error
  return data ?? []
}

// Admin-side roster/status view: every skill suggestion this employer has
// made, whatever its status (suggested/adopted/dismissed) -- mirrors
// listEmployerCourseAssignments' shape. Doesn't resolve the learner's
// email -- callers already have that from listEmployerMembers (keyed by
// user_id).
export async function listEmployerSkillSuggestions(employerId) {
  const { data, error } = await supabase
    .from('employer_skill_suggestions')
    .select('id, skill_library_id, skill_name, learner_id, suggested_target_level, target_date, comments, status, created_at')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Providers tab (20260902310000): purely a listing/linking mechanism for
// additional provider organisations beyond the employer's one auto-
// provisioned attached provider org (employers.provider_organisation_id) --
// linking has no functional effect elsewhere yet (doesn't widen course-
// assignment eligibility, grants no access, needs no consent from the
// linked org). RLS alone (is_employer_member for select, is_employer_admin
// for insert/delete) fully expresses this, so these are plain table calls,
// no RPC needed. Joined to organisations(id, name, org_code) for display --
// mirrors listEmployerCourseAssignments' join-for-display shape.
export async function listEmployerLinkedProviders(employerId) {
  const { data, error } = await supabase
    .from('employer_linked_providers')
    .select('id, provider_organisation_id, linked_by, created_at, organisations(id, name, org_code)')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function linkProviderToEmployer(employerId, providerOrganisationId, linkedBy) {
  const { data, error } = await supabase
    .from('employer_linked_providers')
    .insert({ employer_id: employerId, provider_organisation_id: providerOrganisationId, linked_by: linkedBy })
    .select('id, provider_organisation_id, linked_by, created_at, organisations(id, name, org_code)')
    .single()
  if (error) throw error
  return data
}

export async function unlinkProviderFromEmployer(linkId) {
  const { error } = await supabase.from('employer_linked_providers').delete().eq('id', linkId)
  if (error) throw error
}
