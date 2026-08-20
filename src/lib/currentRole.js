import { supabase } from './supabaseClient'

export function isCurrentEmployment(experience) {
  return experience?.type === 'employment' && !experience?.end_date
}

// Every ongoing (no end date) job on the learner's Experience timeline --
// the candidate targets for "part of my current role".
export async function listCurrentRoleExperiences(userId) {
  const { data } = await supabase
    .from('experience')
    .select('id, title, organization')
    .eq('user_id', userId)
    .eq('type', 'employment')
    .is('end_date', null)
    .order('start_date', { ascending: false })
  return data ?? []
}

async function createCurrentRoleExperience(userId) {
  const { data, error } = await supabase
    .from('experience')
    .insert({
      type: 'employment',
      title: 'Current role',
      start_date: new Date().toISOString().slice(0, 10),
      user_id: userId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

async function linkSkillToExperiences(userId, skillId, experienceIds) {
  if (experienceIds.length === 0) return
  const { data: existingLinks } = await supabase
    .from('skill_experience_links')
    .select('experience_id')
    .eq('skill_id', skillId)
    .in('experience_id', experienceIds)
  const linkedIds = new Set((existingLinks ?? []).map((l) => l.experience_id))
  const missing = experienceIds.filter((id) => !linkedIds.has(id))
  if (missing.length > 0) {
    await supabase.from('skill_experience_links').insert(
      missing.map((experience_id) => ({ user_id: userId, skill_id: skillId, experience_id }))
    )
  }
}

// Called after a skill_experience_links row involving a current (ongoing)
// employment entry is added or removed, to keep skills.is_current_role
// matching whether the skill is still linked to at least one ongoing
// employment entry.
export async function syncSkillIsCurrentRole(userId, skillId) {
  const roles = await listCurrentRoleExperiences(userId)

  let stillLinked = false
  if (roles.length > 0) {
    const { data: links } = await supabase
      .from('skill_experience_links')
      .select('id')
      .eq('skill_id', skillId)
      .in('experience_id', roles.map((r) => r.id))
      .limit(1)
    stillLinked = (links ?? []).length > 0
  }

  await supabase.from('skills').update({ is_current_role: stillLinked }).eq('id', skillId)
}

// Turns "part of my current role" on for a skill. With no ongoing job yet,
// creates one (titled "Current role") and links it. With exactly one,
// links it directly -- no decision for the learner to make either way.
// With more than one, there's a real choice to make, so this returns
// { needsSelection: true, roles } instead of guessing; the caller shows a
// picker and finishes the job via applyCurrentRoleSelection.
export async function enableCurrentRole(userId, skillId) {
  const roles = await listCurrentRoleExperiences(userId)

  if (roles.length === 0) {
    const newId = await createCurrentRoleExperience(userId)
    await linkSkillToExperiences(userId, skillId, [newId])
    await syncSkillIsCurrentRole(userId, skillId)
    return { needsSelection: false }
  }

  if (roles.length === 1) {
    await linkSkillToExperiences(userId, skillId, [roles[0].id])
    await syncSkillIsCurrentRole(userId, skillId)
    return { needsSelection: false }
  }

  return { needsSelection: true, roles }
}

// Finishes what enableCurrentRole started once the learner has picked
// which of their several current roles this skill applies to.
export async function applyCurrentRoleSelection(userId, skillId, experienceIds) {
  await linkSkillToExperiences(userId, skillId, experienceIds)
  await syncSkillIsCurrentRole(userId, skillId)
}

// Turns "part of my current role" off: removes links to every current
// (ongoing) employment entry.
export async function disableCurrentRole(userId, skillId) {
  const roles = await listCurrentRoleExperiences(userId)
  if (roles.length > 0) {
    await supabase
      .from('skill_experience_links')
      .delete()
      .eq('skill_id', skillId)
      .in('experience_id', roles.map((r) => r.id))
  }
  await syncSkillIsCurrentRole(userId, skillId)
}
