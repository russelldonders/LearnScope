import { supabase } from '../supabaseClient'

const CATALOGUE_COUNTS_SELECT = '*, course_catalogue_publications(count), catalogue_skills(count), catalogue_resources(count), catalogue_approvers(count)'

function withCatalogueCounts(catalogue) {
  return {
    ...catalogue,
    courseCount: catalogue.course_catalogue_publications?.[0]?.count ?? 0,
    skillCount: catalogue.catalogue_skills?.[0]?.count ?? 0,
    resourceCount: catalogue.catalogue_resources?.[0]?.count ?? 0,
    userCount: catalogue.catalogue_approvers?.[0]?.count ?? 0,
  }
}

// This organisation's own catalogues plus any other provider's catalogue
// it has linked (catalogue_links, 20260905180000) to offer alongside its
// own -- isOwn distinguishes the two so the console can badge them
// clearly, matching the reason catalogue_links exists as a plain
// reference/association rather than granting any write access: a linked
// catalogue's own admins/approvers are the only ones who can add courses to
// it or manage it, this org is just choosing to also present it.
export async function listProviderCatalogues(organisationId) {
  const [{ data: ownData, error: ownError }, { data: linkData, error: linkError }] = await Promise.all([
    supabase.from('catalogues').select(CATALOGUE_COUNTS_SELECT).eq('organisation_id', organisationId).order('created_at'),
    supabase
      .from('catalogue_links')
      .select(`id, created_at, catalogue:catalogue_id(${CATALOGUE_COUNTS_SELECT}, organisations(name))`)
      .eq('organisation_id', organisationId)
      .order('created_at'),
  ])
  if (ownError) throw ownError
  if (linkError) throw linkError
  const own = (ownData ?? []).map((catalogue) => ({ ...withCatalogueCounts(catalogue), isOwn: true }))
  const linked = (linkData ?? [])
    .filter((link) => link.catalogue)
    .map((link) => ({
      ...withCatalogueCounts(link.catalogue),
      isOwn: false,
      linkId: link.id,
      ownerOrganisationName: link.catalogue.organisations?.name ?? null,
    }))
  return [...own, ...linked]
}

// Existing (non-global, not already this org's own or already linked)
// catalogues a provider could link -- catalogues are already fully
// readable by any authenticated user (0111), this is just the picker's own
// convenience search+exclusion list; guard_catalogue_link_trigger enforces
// the same two exclusions server-side regardless.
export async function listLinkableCatalogues(organisationId, query) {
  const q = query.trim()
  if (!q) return []
  let request = supabase
    .from('catalogues')
    .select('id, name, description, organisations(name)')
    .eq('is_global', false)
    .neq('organisation_id', organisationId)
    .ilike('name', `%${q}%`)
    .limit(20)
  const { data, error } = await request
  if (error) throw error
  const { data: existingLinks, error: linkError } = await supabase
    .from('catalogue_links')
    .select('catalogue_id')
    .eq('organisation_id', organisationId)
  if (linkError) throw linkError
  const linkedIds = new Set((existingLinks ?? []).map((l) => l.catalogue_id))
  return (data ?? []).filter((c) => !linkedIds.has(c.id))
}

export async function linkCatalogueToOrganisation(catalogueId, organisationId, linkedBy) {
  const { data, error } = await supabase
    .from('catalogue_links')
    .insert({ catalogue_id: catalogueId, organisation_id: organisationId, linked_by: linkedBy })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function unlinkCatalogueFromOrganisation(linkId) {
  const { error } = await supabase.from('catalogue_links').delete().eq('id', linkId)
  if (error) throw error
}

export async function getProviderCatalogue(id) {
  const { data, error } = await supabase.from('catalogues').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createProviderCatalogue(userId, organisationId, { name, description, learnerVisible = false }) {
  const { data, error } = await supabase
    .from('catalogues')
    .insert({
      organisation_id: organisationId,
      name: name.trim(),
      description: description?.trim() || null,
      learner_visible: learnerVisible,
      created_by: userId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProviderCatalogue(id, { name, description, learnerVisible }) {
  const { data, error } = await supabase
    .from('catalogues')
    .update({
      name: name.trim(),
      description: description?.trim() || null,
      learner_visible: learnerVisible,
      updated_at: new Date().toISOString(),
    })
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
    .select('id, resource:resource_id(id, title, type, file_name, external_url, version_number, status, is_current_published)')
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
