import { supabase } from './supabaseClient'
import { findOrCreatePersonalSkill } from './skillLibrary'

// Learner-side of Phase 6 (employer skill suggestions, mirrors Phase 3's
// course-assignment "push, don't force" pattern -- see
// suggestSkillToEmployerMembers/listEmployerSkillSuggestions in
// src/lib/admin/employers.js for the admin side, and
// 20260902230000_employer_skill_suggestions.sql for the schema/RLS).
//
// Pending 'suggested' rows for the current user, joined to the course's own
// details and the employer that suggested it -- mirrors
// listMyCourseAssignments' join-shape exactly, surfaced on /actions the
// same way.
export async function listMySkillSuggestions(userId) {
  const { data, error } = await supabase
    .from('employer_skill_suggestions')
    .select('id, skill_library_id, skill_name, suggested_target_level, target_date, comments, status, created_at, employers(id, name)')
    .eq('learner_id', userId)
    .eq('status', 'suggested')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// The learner's own response to a pushed suggestion -- never creates or
// modifies their skills/skill_targets rows silently. "Add to my skills"
// calls the existing, unchanged findOrCreatePersonalSkill to resolve-or-
// create the real skills row (that's still the only thing that puts
// anything on their profile), then -- only if the learner chose to set a
// target -- inserts a skill_targets row shaped exactly like
// SetTargetModal's own insert (target_level/target_date/comments, all
// learner-reviewed/editable before this is called, not a silent copy of
// the employer's suggested values), then marks this suggestion 'adopted'
// purely to drop it off their pending-suggestions list. "Dismiss" just
// marks it 'dismissed' without ever touching skills/skill_targets.
export async function adoptSkillSuggestion(userId, suggestion, { targetLevel = null, targetDate = null, comments = null } = {}) {
  // skill_targets.target_date is not-null (0031) -- same requirement
  // SetTargetModal enforces client-side. A level with no date is rejected
  // here rather than silently dropping the target.
  if (targetLevel != null && !targetDate) {
    throw new Error('Target date is required when setting a target level.')
  }

  const { skill } = await findOrCreatePersonalSkill(userId, suggestion.skill_name)

  if (targetLevel != null) {
    const { error: targetError } = await supabase.from('skill_targets').insert({
      skill_id: skill.id,
      user_id: userId,
      target_level: targetLevel,
      target_date: targetDate,
      comments: comments?.trim() || null,
    })
    if (targetError) throw targetError
  }

  const { error } = await supabase
    .from('employer_skill_suggestions')
    .update({ status: 'adopted' })
    .eq('id', suggestion.id)
  if (error) throw error

  return skill
}

export async function dismissSkillSuggestion(suggestionId) {
  const { error } = await supabase
    .from('employer_skill_suggestions')
    .update({ status: 'dismissed' })
    .eq('id', suggestionId)
  if (error) throw error
}
