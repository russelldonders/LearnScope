import { supabase } from './supabaseClient'

export async function listLibrarySkills() {
  const { data, error } = await supabase
    .from('skill_library')
    .select('id, name, category, description, is_private')
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
      error?.message?.includes('skill_library_private_name_lower_idx'))
  )
}

export function duplicateLibrarySkillMessage(error, name) {
  if (error?.message?.includes('skill_library_private_name_lower_idx')) {
    return `You already have a private skill named "${name.trim()}".`
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
      const { data: retry } = await supabase
        .from('skill_library')
        .select('id')
        .ilike('name', trimmed)
        .limit(1)
        .maybeSingle()
      if (retry) return retry.id
    }
    throw error
  }
  return data.id
}
