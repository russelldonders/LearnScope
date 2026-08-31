import { supabase } from './supabaseClient'
import { findOrCreatePersonalSkill } from './skillLibrary'
import { syncSkillIsCurrentRole } from './currentRole'

export async function recommendExperienceSkills(experience, linkedSkillNames) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')

  const res = await fetch('/api/suggest-tags', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      operation: 'experience-skills',
      experience: {
        type: experience.type,
        title: experience.title,
        organization: experience.organization,
        description: experience.description,
      },
      linkedSkillNames,
    }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Failed to recommend skills.')
  return (body.recommendations ?? []).slice(0, 3)
}

export async function addRecommendedSkills({ userId, experienceId, names }) {
  const added = []
  for (const name of names) {
    const { skill, created } = await findOrCreatePersonalSkill(userId, name)
    const { error } = await supabase.from('skill_experience_links').insert({
      user_id: userId,
      skill_id: skill.id,
      experience_id: experienceId,
    })
    if (error && error.code !== '23505') throw error
    // Same belt-and-suspenders sync FindSkillModal does after linking a
    // skill to an experience -- keeps skills.is_current_role accurate
    // whether the link came from a search/create pick or an AI suggestion.
    await syncSkillIsCurrentRole(userId, skill.id)
    added.push({ ...skill, created })
  }
  return added
}
