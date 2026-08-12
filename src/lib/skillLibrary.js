import { supabase } from './supabaseClient'

export async function listLibrarySkills() {
  const { data, error } = await supabase
    .from('skill_library')
    .select('id, name, category, description')
    .order('name')
    .limit(500)
  if (error) throw error
  return data ?? []
}

// Case-insensitive exact-name match: reuse the existing library entry if
// one exists, otherwise add a new one. Used wherever a user types a skill
// name that isn't already in their personal list, so the same skill isn't
// re-invented with slightly different casing every time someone creates it.
export async function findOrCreateLibrarySkill(name, category, userId) {
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
    .insert({ name: trimmed, category: category?.trim() || null, created_by: userId })
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
