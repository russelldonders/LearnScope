import { supabase } from '../supabaseClient'

// The provider console's "Skills" tab: browsing shows the shared public
// library plus this organisation's own provider-specific entries (RLS,
// 0076, would silently drop any other org's provider-specific rows even if
// this filter didn't -- narrowing here just avoids asking for rows the
// caller could never see). Deactivated (platform-admin-moderated) entries
// are excluded, same as the learner-facing listLibrarySkills.
export async function listOrganisationLibrarySkills(organisationId) {
  const { data, error } = await supabase
    .from('skill_library')
    .select('id, name, category, description, organisation_id')
    .eq('status', 'active')
    .or(`organisation_id.is.null,organisation_id.eq.${organisationId}`)
    .order('name')
    .limit(1000)
  if (error) throw error
  return data ?? []
}

// Creates a skill scoped to this organisation only -- never appears in the
// public library or another organisation's browse list (0076's RLS),
// distinct from is_private which is a single learner's own privacy setting.
export async function createProviderLibrarySkill(userId, organisationId, { name, category, description }) {
  const { data, error } = await supabase
    .from('skill_library')
    .insert({
      name: name.trim(),
      category: category?.trim() || null,
      description: description?.trim() || null,
      organisation_id: organisationId,
      created_by: userId,
    })
    .select('id, name, category, description, organisation_id')
    .single()
  if (error) throw error
  return data
}

// The standalone "skills we offer our customers" roster (organisation_
// offered_skills, 0076) -- independent of any specific course.
export async function listOfferedSkillIds(organisationId) {
  const { data, error } = await supabase
    .from('organisation_offered_skills')
    .select('skill_library_id')
    .eq('organisation_id', organisationId)
  if (error) throw error
  return (data ?? []).map((r) => r.skill_library_id)
}

export async function addOfferedSkill(organisationId, skillLibraryId, userId) {
  const { error } = await supabase
    .from('organisation_offered_skills')
    .insert({ organisation_id: organisationId, skill_library_id: skillLibraryId, created_by: userId })
  if (error) throw error
}

export async function removeOfferedSkill(organisationId, skillLibraryId) {
  const { error } = await supabase
    .from('organisation_offered_skills')
    .delete()
    .eq('organisation_id', organisationId)
    .eq('skill_library_id', skillLibraryId)
  if (error) throw error
}
