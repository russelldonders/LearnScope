import { supabase } from './supabaseClient'

// Learner-facing search: deactivated entries (platform-admin moderation,
// see AdminSkills) shouldn't be findable/reusable here.
export async function listLibrarySkills() {
  const { data, error } = await supabase
    .from('skill_library')
    .select('id, name, category, description, is_private')
    .eq('status', 'active')
    .order('name')
    .limit(500)
  if (error) throw error
  return data ?? []
}

// skill_library(lower(name)) is only unique among public entries (0028);
// private entries are unique per creator instead, since a private entry
// invisible to everyone else can't be allowed to block a public name.
export function isDuplicateLibrarySkillError(error) {
  return (
    error?.code === '23505' &&
    (error?.message?.includes('skill_library_public_name_lower_idx') ||
      error?.message?.includes('skill_library_private_name_lower_idx') ||
      error?.message?.includes('skill_library_org_name_lower_idx'))
  )
}

export function duplicateLibrarySkillMessage(error, name) {
  if (error?.message?.includes('skill_library_private_name_lower_idx')) {
    return `You already have a private skill named "${name.trim()}".`
  }
  if (error?.message?.includes('skill_library_org_name_lower_idx')) {
    return `Your organisation already has a skill named "${name.trim()}".`
  }
  return `A skill named "${name.trim()}" already exists in the library — use the search above to find and add it instead.`
}

// Library entries linked to any of the given interest tags, via
// skill_library_tags (0055) -- used to filter "skills you might want to
// learn" without touching any other learner's private skill_tags rows.
export async function listLibrarySkillIdsForTags(tagIds) {
  if (!tagIds?.length) return []
  const { data, error } = await supabase
    .from('skill_library_tags')
    .select('skill_library_id')
    .in('tag_id', tagIds)
  if (error) throw error
  return [...new Set((data ?? []).map((r) => r.skill_library_id))]
}

// Case-insensitive exact-name match: reuse the existing library entry if
// one exists, otherwise add a new one. Used wherever a user types a skill
// name that isn't already in their personal list, so the same skill isn't
// re-invented with slightly different casing every time someone creates it.
export async function findOrCreateLibrarySkill(name, category, userId, isPrivate = false) {
  const trimmed = name.trim()
  const { data: existing } = await supabase
    .from('skill_library')
    .select('id')
    .ilike('name', trimmed)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('skill_library')
    .insert({ name: trimmed, category: category?.trim() || null, created_by: userId, is_private: isPrivate })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') {
      // Re-apply the same active-only filter as the initial lookup above --
      // without it, a name collision with a platform-admin-deactivated
      // entry (0066) would silently resolve to and reuse that moderated
      // row, bypassing deactivation entirely.
      const { data: retry } = await supabase
        .from('skill_library')
        .select('id')
        .ilike('name', trimmed)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      if (retry) return retry.id
      throw new Error(
        `A skill named "${trimmed}" already exists but has been deactivated. Contact support if you believe this is a mistake.`
      )
    }
    throw error
  }
  return data.id
}

async function findPersonalSkillByName(userId, name) {
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

// Case-insensitive: reuses the learner's existing personal skill with this
// name if they already have one, otherwise creates both the library entry
// (via findOrCreateLibrarySkill) and their personal skills row for it.
// Used wherever a skill needs to be created inline as a side effect of some
// other flow -- an AI suggestion picked, a skill typed while logging an
// activity -- rather than through the full "Find a skill" wizard.
export async function findOrCreatePersonalSkill(userId, name) {
  const existing = await findPersonalSkillByName(userId, name)
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
    const raced = await findPersonalSkillByName(userId, name)
    if (raced) return { skill: raced, created: false }
  }
  throw error
}
