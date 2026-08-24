import { supabase } from '../supabaseClient'
import { callAdminApi } from './adminApi'

export async function listOrganisations() {
  const { data, error } = await supabase.from('organisations').select('*').order('name')
  if (error) throw error
  return data ?? []
}

export async function createOrganisation(userId, name) {
  const { data, error } = await supabase
    .from('organisations')
    .insert({ name: name.trim(), created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function setOrganisationStatus(id, status) {
  const { error } = await supabase
    .from('organisations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function updateOrganisation(id, { name, url }) {
  const { data, error } = await supabase
    .from('organisations')
    .update({ name: name.trim(), url: url?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listOrganisationMembers(organisationId) {
  const { data, error } = await supabase
    .from('organisation_members')
    .select('id, user_id, role, created_at')
    .eq('organisation_id', organisationId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function removeOrganisationMember(memberRowId) {
  const { error } = await supabase.from('organisation_members').delete().eq('id', memberRowId)
  if (error) throw error
}

// Invites a new staff member (or org admin) by email, then links them to
// this organisation -- service-role, since it needs to both send an auth
// invite and re-verify the caller's org-admin/platform-admin authority
// server-side (see api/org/invite-staff.js).
export async function inviteOrganisationStaff(organisationId, email, role) {
  return callAdminApi('inviteOrgStaff', { organisationId, email, role })
}
