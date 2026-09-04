import { supabase } from '../supabaseClient'

// Admin listing -- every status, unlike src/lib/skillLibrary.js's
// listLibrarySkills (learner-facing, active-only).
const ADMIN_SKILL_SELECT = 'id, skill_code, name, category, description, status, is_private, organisation_id, created_by'

// skill_library.created_by only references auth.users, and organisation_id
// references organisations -- neither is a foreign key PostgREST can embed
// directly into profiles (which keys off auth.users, not skill_library), so
// owner names are resolved with a couple of extra lookups and merged in
// client-side, same shape as listUsers()/getUserProfile() do for
// organisation names elsewhere in the admin console.
async function attachOwnerInfo(skills) {
  const userIds = [...new Set(skills.map((s) => s.created_by).filter(Boolean))]
  const orgIds = [...new Set(skills.map((s) => s.organisation_id).filter(Boolean))]

  const [profilesResult, orgsResult, systemOrgResult] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id, first_name, last_name').in('id', userIds)
      : Promise.resolve({ data: [] }),
    orgIds.length
      ? supabase.from('organisations').select('id, name').in('id', orgIds)
      : Promise.resolve({ data: [] }),
    supabase.from('organisations').select('id, name').eq('is_system', true).maybeSingle(),
  ])
  if (profilesResult.error) throw profilesResult.error
  if (orgsResult.error) throw orgsResult.error
  if (systemOrgResult.error) throw systemOrgResult.error

  const nameByUserId = new Map(
    (profilesResult.data ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || null])
  )
  const orgNameById = new Map((orgsResult.data ?? []).map((o) => [o.id, o.name]))
  const systemOrg = systemOrgResult.data ?? null

  return skills.map((s) => ({
    ...s,
    // Mirrors the mutual-exclusivity the DB itself enforces (0076's
    // skill_library_org_not_private check): a skill is exactly one of
    // global (shared, public), personal (one learner's private entry), or
    // provider (a specific organisation's own).
    type: s.organisation_id ? 'provider' : s.is_private ? 'personal' : 'global',
    providerId: s.organisation_id ?? (!s.is_private ? systemOrg?.id ?? null : null),
    providerName: s.organisation_id
      ? (orgNameById.get(s.organisation_id) ?? 'Unknown organisation')
      : (!s.is_private ? systemOrg?.name ?? 'Global provider' : null),
    ownerName: s.organisation_id
      ? (orgNameById.get(s.organisation_id) ?? 'Unknown organisation')
      : (nameByUserId.get(s.created_by) ?? null),
  }))
}

export async function listAllLibrarySkills() {
  const { data, error } = await supabase
    .from('skill_library')
    .select(ADMIN_SKILL_SELECT)
    .order('name')
    .limit(1000)
  if (error) throw error
  return attachOwnerInfo(data ?? [])
}

// Includes the shared level-guide cache columns (0089) on top of
// ADMIN_SKILL_SELECT -- only needed for this single-skill detail fetch, not
// the list view, so kept out of the shared constant.
export async function getLibrarySkill(id) {
  const { data, error } = await supabase
    .from('skill_library')
    .select(`${ADMIN_SKILL_SELECT}, knowledge_level_guide, practical_level_guide`)
    .eq('id', id)
    .single()
  if (error) throw error
  const [withOwner] = await attachOwnerInfo([data])
  return withOwner
}

// Courses that reference this skill via course_catalogue_skills (0036) --
// a single join query (no N+1), scoped to each course's currently-published
// version so a skill page doesn't list every superseded draft/rejected
// version of the same course alongside it. Table RLS ("Authenticated users
// can view course catalogue skills") and course_catalogue's own admin-sees-
// everything RLS both already allow a platform admin to read this directly,
// same as listAllCatalogueCourses.
export async function listCoursesForSkill(skillLibraryId) {
  const { data, error } = await supabase
    .from('course_catalogue_skills')
    .select('level, course_catalogue:course_catalogue_id!inner(id, name, status, is_current_published)')
    .eq('skill_library_id', skillLibraryId)
    .eq('course_catalogue.is_current_published', true)
    .order('name', { referencedTable: 'course_catalogue' })
  if (error) throw error
  return (data ?? [])
    .filter((r) => r.course_catalogue)
    .map((r) => ({ id: r.course_catalogue.id, name: r.course_catalogue.name, status: r.course_catalogue.status, level: r.level }))
}

export async function updateLibrarySkill(id, fields) {
  const { error } = await supabase.from('skill_library').update(fields).eq('id', id)
  if (error) throw error
}

export async function setLibrarySkillStatus(id, status) {
  return updateLibrarySkill(id, { status })
}
