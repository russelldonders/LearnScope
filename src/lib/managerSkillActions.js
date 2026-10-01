import { supabase } from './supabaseClient'
import { findOrCreatePersonalSkill } from './skillLibrary'
import { getProfiles } from './connections'

// Learner side of what managers do -- suggest a skill, rate a skill, set a
// target -- across both management contexts: an independent manager team
// and an organisation reporting line. Reads the unified manager_skill_*
// tables (20261001110000). While the merge is in progress the original
// per-context tables are still the ones written to (a trigger mirrors them
// here), so a learner's response is applied to the original row, found via
// legacy_source/legacy_id.

const LEGACY_SUGGESTION_TABLES = new Set(['manager_team_skill_suggestions', 'employer_skill_suggestions'])

export function suggestionSourceLabel({ contextType, contextName, suggestedByName }) {
  if (contextType === 'team') return suggestedByName ? `${suggestedByName} (${contextName})` : contextName
  return contextName
}

// Pending suggestions for the current learner, newest first, one shape
// whichever context they came from.
export async function listMyManagerSkillSuggestions(userId) {
  const { data, error } = await supabase
    .from('manager_skill_suggestions')
    .select('id, context_type, context_name, skill_library_id, skill_name, suggested_target_level, target_date, comments, suggested_by, created_at, legacy_source, legacy_id')
    .eq('learner_id', userId)
    .eq('status', 'suggested')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = data ?? []
  const profiles = await getProfiles(rows.map((row) => row.suggested_by))
  return rows.map((row) => {
    const suggestion = {
      id: row.id,
      contextType: row.context_type,
      contextName: row.context_name,
      skillLibraryId: row.skill_library_id,
      skillName: row.skill_name,
      suggestedTargetLevel: row.suggested_target_level,
      targetDate: row.target_date,
      comments: row.comments,
      createdAt: row.created_at,
      suggestedByName: profiles[row.suggested_by]?.name ?? null,
      legacySource: row.legacy_source,
      legacyId: row.legacy_id,
    }
    return { ...suggestion, sourceLabel: suggestionSourceLabel(suggestion) }
  })
}

async function setSuggestionStatus(suggestion, status) {
  if (!LEGACY_SUGGESTION_TABLES.has(suggestion.legacySource) || !suggestion.legacyId) {
    throw new Error('This suggestion can no longer be updated.')
  }
  const { error } = await supabase.from(suggestion.legacySource).update({ status }).eq('id', suggestion.legacyId)
  if (error) throw error
}

// "Add to my skills": resolves-or-creates the learner's own skills row and,
// only if they chose to keep a target, adds it as their own target (shaped
// like SetTargetModal's insert, with the values they reviewed -- never a
// silent copy of the suggester's). Then marks the suggestion adopted, which
// only drops it from the pending list.
export async function adoptManagerSkillSuggestion(userId, suggestion, { targetLevel = null, targetDate = null, comments = null } = {}) {
  if (targetLevel != null && !targetDate) {
    throw new Error('Target date is required when setting a target level.')
  }

  const { skill } = await findOrCreatePersonalSkill(userId, suggestion.skillName)

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

  await setSuggestionStatus(suggestion, 'adopted')
  return skill
}

export async function dismissManagerSkillSuggestion(suggestion) {
  await setSuggestionStatus(suggestion, 'dismissed')
}
