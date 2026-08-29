import { supabase } from './supabaseClient'

export async function listProviderCatalogues(organisationId) {
  const { data, error } = await supabase
    .from('catalogues')
    .select('id, name, description, organisation_id, is_global, created_at')
    .eq('organisation_id', organisationId)
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function listPublicationCatalogueOptions(organisationId) {
  const { data, error } = await supabase
    .from('catalogues')
    .select('id, name, description, organisation_id, is_global')
    .or(`is_global.eq.true,organisation_id.eq.${organisationId}`)
    .order('is_global', { ascending: false })
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function createProviderCatalogue(userId, organisationId, { name, description }) {
  const { data, error } = await supabase
    .from('catalogues')
    .insert({
      organisation_id: organisationId,
      name: name.trim(),
      description: description.trim() || null,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProviderCatalogue(id, { name, description }) {
  const { error } = await supabase
    .from('catalogues')
    .update({ name: name.trim(), description: description.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteProviderCatalogue(id) {
  const { error } = await supabase.from('catalogues').delete().eq('id', id)
  if (error) throw error
}
