import { supabase } from '../supabaseClient'

// The provider console's "Skills" tab shows this organisation's offered-
// skills roster (organisation_offered_skills, 0076) as the primary list --
// skill_library_id is a real FK, so PostgREST can embed the skill's details
// directly instead of a second round-trip. Rows whose skill_library entry
// no longer resolves under RLS (shouldn't normally happen -- 0077 requires
// the referenced skill to already be visible to this org) are dropped
// defensively rather than rendered with missing details.
export async function listOrganisationOfferedSkills(organisationId) {
  const { data, error } = await supabase
    .from('organisation_offered_skills')
    .select('id, skill_library:skill_library_id(id, skill_code, name, category, description, organisation_id)')
    .eq('organisation_id', organisationId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? [])
    .filter((r) => r.skill_library)
    .map((r) => ({
      offeredId: r.id,
      skillLibraryId: r.skill_library.id,
      skillCode: r.skill_library.skill_code,
      name: r.skill_library.name,
      category: r.skill_library.category,
      description: r.skill_library.description,
      isOwnOrgSkill: r.skill_library.organisation_id === organisationId,
    }))
}

// Creates a skill scoped to this organisation only -- never appears in the
// public library or another organisation's browse list (0076's RLS),
// distinct from is_private which is a single learner's own privacy
// setting -- then immediately adds it to the org's offered roster, since
// only this org can ever see the skill at all, so leaving it un-offered
// would make it invisible everywhere, including to its own creator.
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
    .select('id')
    .single()
  if (error) throw error
  await addOfferedSkill(organisationId, data.id, userId)
  return data
}

export async function addOfferedSkill(organisationId, skillLibraryId, userId) {
  const { error } = await supabase
    .from('organisation_offered_skills')
    .insert({ organisation_id: organisationId, skill_library_id: skillLibraryId, created_by: userId })
  if (error) throw error
}

// Only removes the roster association -- the underlying skill_library row
// (public or this org's own) is never deleted, same "unlink, don't delete
// the source record" rule as every other association in this app.
export async function removeOfferedSkill(organisationId, skillLibraryId) {
  const { error } = await supabase
    .from('organisation_offered_skills')
    .delete()
    .eq('organisation_id', organisationId)
    .eq('skill_library_id', skillLibraryId)
  if (error) throw error
}

export async function getProviderSkillAlignment(organisationId, skillLibraryId) {
  const [{ data: courses, error: coursesError }, { data: resources, error: resourcesError }] = await Promise.all([
    supabase
      .from('course_catalogue')
      .select('id, name, course_code, course_type, status, version_number, course_catalogue_skills(id, level, skill_library_id)')
      .eq('organisation_id', organisationId)
      .eq('status', 'approved')
      .eq('is_current_published', true)
      .order('name'),
    supabase
      .from('content_resources')
      .select('id, title, type, version_number, content_resource_skills(id, skill_library_id)')
      .eq('organisation_id', organisationId)
      .eq('status', 'published')
      .eq('is_current_published', true)
      .order('title'),
  ])
  if (coursesError) throw coursesError
  if (resourcesError) throw resourcesError

  return {
    courses: (courses ?? []).map((course) => {
      const alignment = course.course_catalogue_skills?.find((link) => link.skill_library_id === skillLibraryId)
      return { ...course, alignmentId: alignment?.id ?? null, level: alignment?.level ?? 1 }
    }),
    resources: (resources ?? []).map((resource) => {
      const alignment = resource.content_resource_skills?.find((link) => link.skill_library_id === skillLibraryId)
      return { ...resource, alignmentId: alignment?.id ?? null }
    }),
  }
}

export async function setTrainingSkillAlignment(courseId, skillLibraryId, aligned, level = 1) {
  if (aligned) {
    const { error } = await supabase
      .from('course_catalogue_skills')
      .upsert(
        { course_catalogue_id: courseId, skill_library_id: skillLibraryId, level },
        { onConflict: 'course_catalogue_id,skill_library_id' }
      )
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('course_catalogue_skills')
    .delete()
    .eq('course_catalogue_id', courseId)
    .eq('skill_library_id', skillLibraryId)
  if (error) throw error
}

export async function setResourceSkillAlignment(resourceId, skillLibraryId, userId, aligned) {
  if (aligned) {
    const { error } = await supabase
      .from('content_resource_skills')
      .insert({ resource_id: resourceId, skill_library_id: skillLibraryId, created_by: userId })
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('content_resource_skills')
    .delete()
    .eq('resource_id', resourceId)
    .eq('skill_library_id', skillLibraryId)
  if (error) throw error
}
