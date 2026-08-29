import { supabase } from './supabaseClient'
import { findOrCreateLibrarySkill } from './skillLibrary'

export async function recommendExperienceSkills(experience, linkedSkillNames) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')

  const res = await fetch('/api/recommend-experience-skills', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
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

async function findPersonalSkill(userId, name) {
  const { data, error } = await supabase
    .from('skills')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', name.trim())
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

async function ensurePersonalSkill(userId, name) {
  const existing = await findPersonalSkill(userId, name)
  if (existing) return { skill: existing, created: false }

  const librarySkillId = await findOrCreateLibrarySkill(name, null, userId)
  const { data, error } = await supabase
    .from('skills')
    .insert({
      name: name.trim(),
      level: null,
      is_current_role: false,
      tracking_reason: 'career_development',
      lifecycle_stage: 'identified',
      library_skill_id: librarySkillId,
      user_id: userId,
    })
    .select('id, name')
    .single()

  if (!error) return { skill: data, created: true }
  if (error.code === '23505') {
    const raced = await findPersonalSkill(userId, name)
    if (raced) return { skill: raced, created: false }
  }
  throw error
}

export async function addRecommendedSkills({ userId, experienceId, names }) {
  const added = []
  for (const name of names) {
    const { skill, created } = await ensurePersonalSkill(userId, name)
    const { error } = await supabase.from('skill_experience_links').insert({
      user_id: userId,
      skill_id: skill.id,
      experience_id: experienceId,
    })
    if (error && error.code !== '23505') throw error
    added.push({ ...skill, created })
  }
  return added
}
