import { supabase } from '../supabaseClient'

// Admin listing -- every status, unlike src/lib/skillLibrary.js's
// listLibrarySkills (learner-facing, active-only).
export async function listAllLibrarySkills() {
  const { data, error } = await supabase
    .from('skill_library')
    .select('id, name, category, description, status, is_private')
    .order('name')
    .limit(1000)
  if (error) throw error
  return data ?? []
}

export async function updateLibrarySkill(id, fields) {
  const { error } = await supabase.from('skill_library').update(fields).eq('id', id)
  if (error) throw error
}

export async function setLibrarySkillStatus(id, status) {
  return updateLibrarySkill(id, { status })
}
