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

// Only touches the fields actually passed -- AdminProviders.jsx's edit form
// only ever sends {name, url}, and shouldn't silently null out `about` just
// because it doesn't know about that field; the provider-facing settings
// modal (OrganisationSettingsModal.jsx) does the reverse, sending
// {url, about} without `name` -- 0081's identity-change trigger only fires
// on an actual value change, so omitting `name` entirely here is what lets
// an org admin's update through without needing platform-admin rights.
export async function updateOrganisation(id, { name, url, about } = {}) {
  const fields = { updated_at: new Date().toISOString() }
  if (name !== undefined) fields.name = name.trim()
  if (url !== undefined) fields.url = url?.trim() || null
  if (about !== undefined) fields.about = about?.trim() || null

  const { data, error } = await supabase.from('organisations').update(fields).eq('id', id).select().single()
  if (error) throw error
  return data
}

// Same public-bucket, upsert-in-place pattern as src/lib/avatar.js's
// uploadAvatar, scoped by organisation_id instead of user_id (0081).
export async function uploadOrganisationLogo(organisationId, fileOrBlob) {
  const ext = fileOrBlob.type?.split('/')[1] || 'png'
  const path = `${organisationId}/logo.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('org-logos')
    .upload(path, fileOrBlob, { upsert: true, contentType: fileOrBlob.type })
  if (uploadError) throw uploadError

  const { data } = supabase.storage.from('org-logos').getPublicUrl(path)
  const url = `${data.publicUrl}?t=${Date.now()}`

  const { error: orgError } = await supabase
    .from('organisations')
    .update({ logo_url: url, updated_at: new Date().toISOString() })
    .eq('id', organisationId)
  if (orgError) throw orgError

  return url
}

export async function removeOrganisationLogo(organisationId) {
  const { error } = await supabase
    .from('organisations')
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq('id', organisationId)
  if (error) throw error
}

// Routed through the service-role dispatcher (listOrgMembers) rather than a
// direct RLS-scoped query, since organisation_members alone only has
// user_id -- email lives on auth.users, which the client can't read.
export async function listOrganisationMembers(organisationId) {
  const { members } = await callAdminApi('listOrgMembers', { organisationId })
  return members ?? []
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
