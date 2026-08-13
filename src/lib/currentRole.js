import { supabase } from './supabaseClient'

export function isCurrentEmployment(experience) {
  return experience?.type === 'employment' && !experience?.end_date
}

async function currentEmploymentIds(userId) {
  const { data } = await supabase
    .from('experience')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'employment')
    .is('end_date', null)
  return (data ?? []).map((e) => e.id)
}

// Called when a skill's "Part of my current role" checkbox is saved (Add
// or Edit skill). Keeps skill_experience_links matching every ongoing
// employment entry, so the Experience tab's Skills list shows the same
// skills as the Skills page's "Current role" group.
export async function syncCurrentRoleLinks(userId, skillId, isCurrentRole) {
  const jobIds = await currentEmploymentIds(userId)
  if (jobIds.length === 0) return

  if (isCurrentRole) {
    const { data: existingLinks } = await supabase
      .from('skill_experience_links')
      .select('experience_id')
      .eq('skill_id', skillId)
      .in('experience_id', jobIds)
    const linkedIds = new Set((existingLinks ?? []).map((l) => l.experience_id))
    const missing = jobIds.filter((id) => !linkedIds.has(id))
    if (missing.length > 0) {
      await supabase.from('skill_experience_links').insert(
        missing.map((experience_id) => ({
          user_id: userId,
          skill_id: skillId,
          experience_id,
        }))
      )
    }
  } else {
    await supabase
      .from('skill_experience_links')
      .delete()
      .eq('skill_id', skillId)
      .in('experience_id', jobIds)
  }
}

// Called after a skill_experience_links row involving a current (ongoing)
// employment entry is added or removed from the Experience side, to keep
// skills.is_current_role matching whether the skill is still linked to at
// least one ongoing employment entry.
export async function syncSkillIsCurrentRole(userId, skillId) {
  const jobIds = await currentEmploymentIds(userId)

  let stillLinked = false
  if (jobIds.length > 0) {
    const { data: links } = await supabase
      .from('skill_experience_links')
      .select('id')
      .eq('skill_id', skillId)
      .in('experience_id', jobIds)
      .limit(1)
    stillLinked = (links ?? []).length > 0
  }

  await supabase.from('skills').update({ is_current_role: stillLinked }).eq('id', skillId)
}
