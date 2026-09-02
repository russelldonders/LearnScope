import { supabase } from '../supabaseClient'
import { callAdminApi } from './adminApi'

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

// Deliberately "add an existing user by email" only -- unlike
// inviteOrganisationStaff, this never sends a new-account invite. Bulk
// import and inviting people with no LearnScope account yet are explicitly
// later phases (see the employers migration's own comment).
export async function addEmployerMember(employerId, email, role) {
  return callAdminApi('addEmployerMember', { employerId, email, role })
}

export async function removeEmployerMember(memberRowId) {
  const { error } = await supabase.from('employer_members').delete().eq('id', memberRowId)
  if (error) throw error
}
