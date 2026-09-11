import { supabase } from '../supabaseClient'

export function validateLmsConnection(form) {
  const config = { ...form, name: form.name?.trim(), client_id: form.client_id?.trim() }
  if (!config.name || config.name.length > 200) throw new Error('Enter a connection name (up to 200 characters).')
  if (!config.client_id || config.client_id.length > 500) throw new Error('Enter the LMS client ID (up to 500 characters).')
  for (const key of ['issuer', 'authorization_url', 'jwks_url', 'token_url']) {
    const value = form[key]?.trim()
    let url
    try { url = new URL(value) } catch { throw new Error('Enter valid HTTPS URLs for the LMS endpoints.') }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || value.length > 2048 || (key === 'issuer' && url.search)) throw new Error('Use HTTPS endpoints without credentials or fragments; issuer must not contain a query.')
    config[key] = value // OIDC issuer is an exact, case-sensitive identifier.
  }
  config.deployment_ids = [...new Set((Array.isArray(form.deployment_ids) ? form.deployment_ids : form.deployment_ids.split(/\r?\n/)).map((id) => id.trim()).filter(Boolean))]
  if (!config.deployment_ids.length || config.deployment_ids.length > 100 || config.deployment_ids.some((id) => id.length > 500)) throw new Error('Enter 1–100 deployment IDs, one per line (up to 500 characters each).')
  return config
}
export async function listLmsConnections(organisationId) {
  const { data, error } = await supabase.from('lti_connections').select('*').eq('organisation_id', organisationId).order('created_at')
  if (error) throw error
  return data ?? []
}
export async function saveLmsConnection(organisationId, id, form) {
  const { data, error } = await supabase.rpc('save_lti_connection', { p_organisation_id: organisationId, p_id: id, p_config: validateLmsConnection(form) })
  if (error) throw error
  return data
}
export async function listSkillLtiObjects(organisationId, skillId) {
  const { data, error } = await supabase.from('lti_skill_objects').select('*, lti_object_connections(connection_id)').eq('organisation_id', organisationId).eq('skill_library_id', skillId).order('created_at')
  if (error) throw error
  return data ?? []
}
export async function saveSkillLtiObject(organisationId, skillId, id, form, connectionIds) {
  const { data, error } = await supabase.rpc('save_lti_skill_object', { p_organisation_id: organisationId, p_skill_id: skillId, p_id: id, p_config: form, p_connection_ids: connectionIds })
  if (error) throw error
  return data
}
