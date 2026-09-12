import { supabase } from './supabaseClient'

async function result(request) {
  const { data, error } = await request
  if (error) throw error
  return data ?? []
}
export function listSharingConnections(side, id) {
  return result(supabase.from('employer_linked_providers').select('*')
    .eq(side === 'employer' ? 'employer_id' : 'provider_organisation_id', id).order('created_at', { ascending: false }))
}
export function listSharingEmployers(providerId) {
  return result(supabase.rpc('sharing_employer_directory', { p_provider: providerId }))
}
export function listSharingCatalogues(providerId) {
  return result(supabase.from('catalogues')
    .select('id,name,course_catalogue_publications(course_id,published_at,course_catalogue(id,name,status,is_current_published))')
    .eq('organisation_id', providerId).eq('is_global', false).order('name'))
}
export function sendSharingRequest({ employerId, providerId, userId, side, sharing, requestId }) {
  const fields = { linked_by: userId, initiated_by: side, sharing, status: 'pending', decided_at: null, decided_by: null }
  const request = requestId
    ? supabase.from('employer_linked_providers').update(fields).eq('id', requestId)
    : supabase.from('employer_linked_providers').insert({ employer_id: employerId, provider_organisation_id: providerId, ...fields })
  return result(request.select().single())
}
export function updateSharingSelection(row, sharing, side) {
  const fields = row.status === 'accepted'
    ? { pending_sharing: sharing, pending_initiated_by: side }
    : { sharing }
  return result(supabase.from('employer_linked_providers').update(fields).eq('id', row.id).select().single())
}
export function decideSharing(row, accept) {
  const fields = row.pending_sharing
    ? {
        sharing: accept ? row.pending_sharing : row.sharing,
        pending_sharing: null,
        pending_initiated_by: null,
        pending_requested_at: null,
      }
    : { status: accept ? 'accepted' : 'declined' }
  return result(supabase.from('employer_linked_providers').update(fields).eq('id', row.id).select().single())
}
export function removeSharing(id) {
  return result(supabase.from('employer_linked_providers').delete().eq('id', id).select().single())
}
export const emptySharing = () => ({ all: false, catalogues: [] })
export function validSharing(sharing) {
  return sharing.all || (sharing.catalogues.length > 0 && sharing.catalogues.every(c => c.all || c.courses.length > 0))
}
