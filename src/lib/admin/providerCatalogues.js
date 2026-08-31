import { supabase } from '../supabaseClient'

export async function listProviderCatalogues(organisationId) {
  const { data, error } = await supabase
    .from('catalogues')
    .select('*, course_catalogue_publications(count), catalogue_skills(count), catalogue_resources(count), catalogue_approvers(count)')
    .eq('organisation_id', organisationId)
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((catalogue) => ({
    ...catalogue,
    courseCount: catalogue.course_catalogue_publications?.[0]?.count ?? 0,
    skillCount: catalogue.catalogue_skills?.[0]?.count ?? 0,
    resourceCount: catalogue.catalogue_resources?.[0]?.count ?? 0,
    userCount: catalogue.catalogue_approvers?.[0]?.count ?? 0,
  }))
}

export async function getProviderCatalogue(id) {
  const { data, error } = await supabase.from('catalogues').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createProviderCatalogue(userId, organisationId, { name, description }) {
  const { data, error } = await supabase
    .from('catalogues')
    .insert({ organisation_id: organisationId, name: name.trim(), description: description?.trim() || null, created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProviderCatalogue(id, { name, description }) {
  const { data, error } = await supabase
    .from('catalogues')
    .update({ name: name.trim(), description: description?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listProviderCatalogueCourses(catalogueId) {
  const { data, error } = await supabase
    .from('course_catalogue_publications')
    .select('published_at, course:course_id(*)')
    .eq('catalogue_id', catalogueId)
    .order('published_at', { ascending: false })
  if (error) throw error
  return (data ?? []).filter((publication) => publication.course).map((publication) => ({ ...publication.course, published_at: publication.published_at }))
}

export async function listProviderCatalogueSkills(catalogueId) {
  const { data, error } = await supabase
    .from('catalogue_skills')
    .select('id, skill_library:skill_library_id(id, name, category, description)')
    .eq('catalogue_id', catalogueId)
    .order('created_at')
  if (error) throw error
  return (data ?? []).filter((item) => item.skill_library).map((item) => ({ ...item.skill_library, linkId: item.id }))
}

export async function addProviderCatalogueSkill(catalogueId, skillLibraryId, userId) {
  const { error } = await supabase
    .from('catalogue_skills')
    .insert({ catalogue_id: catalogueId, skill_library_id: skillLibraryId, created_by: userId })
  if (error) throw error
}

export async function removeProviderCatalogueSkill(linkId) {
  const { error } = await supabase.from('catalogue_skills').delete().eq('id', linkId)
  if (error) throw error
}

export async function listPublishedProviderCourses(organisationId) {
  const { data, error } = await supabase
    .from('course_catalogue')
    .select('*')
    .eq('organisation_id', organisationId)
    .eq('status', 'approved')
    .eq('is_current_published', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function assignProviderCourseToCatalogue(catalogueId, courseId) {
  const { error } = await supabase.rpc('assign_course_to_catalogue', {
    p_catalogue_id: catalogueId,
    p_course_id: courseId,
  })
  if (error) throw error
}

export async function listProviderCatalogueResources(catalogueId) {
  const { data, error } = await supabase
    .from('catalogue_resources')
    .select('id, resource:resource_id(id, title, type, file_name, external_url)')
    .eq('catalogue_id', catalogueId)
    .order('created_at')
  if (error) throw error
  return (data ?? []).filter((item) => item.resource).map((item) => ({ ...item.resource, linkId: item.id }))
}

export async function addProviderCatalogueResource(catalogueId, resourceId, userId) {
  const { error } = await supabase
    .from('catalogue_resources')
    .insert({ catalogue_id: catalogueId, resource_id: resourceId, created_by: userId })
  if (error) throw error
}

export async function removeProviderCatalogueResource(linkId) {
  const { error } = await supabase.from('catalogue_resources').delete().eq('id', linkId)
  if (error) throw error
}

export async function listProviderCatalogueMembers(catalogueId) {
  const { data, error } = await supabase.from('catalogue_approvers').select('*').eq('catalogue_id', catalogueId).order('created_at')
  if (error) throw error
  return data ?? []
}

export async function upsertProviderCatalogueMember(catalogueId, userId, role, createdBy) {
  const { error } = await supabase
    .from('catalogue_approvers')
    .upsert({ catalogue_id: catalogueId, user_id: userId, role, added_by: createdBy }, { onConflict: 'catalogue_id,user_id' })
  if (error) throw error
}

export async function removeProviderCatalogueMember(id) {
  const { error } = await supabase.from('catalogue_approvers').delete().eq('id', id)
  if (error) throw error
}

export async function approveProviderCatalogueCourse(courseId) {
  const { error } = await supabase.rpc('publish_course_version', { p_course_id: courseId })
  if (error) throw error
}
