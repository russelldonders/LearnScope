import { supabase } from './supabaseClient'
import { findOrCreatePersonalSkill } from './skillLibrary'
import { getProfiles } from './connections'

// Learner side of what managers do -- suggest a skill, rate a skill, set a
// target -- across both management contexts: an independent manager team
// and an organisation reporting line. Reads and responds through the unified
// manager_skill_* tables (20261001110000, written directly since
// 20261002100000).

export function suggestionSourceLabel({ contextType, contextName, suggestedByName }) {
  if (contextType === 'team') return suggestedByName ? `${suggestedByName} (${contextName})` : contextName
  return contextName
}

// Pending suggestions for the current learner, newest first, one shape
// whichever context they came from.
export async function listMyManagerSkillSuggestions(userId) {
  const { data, error } = await supabase
    .from('manager_skill_suggestions')
    .select('id, context_type, context_name, skill_library_id, skill_name, suggested_target_level, target_date, comments, suggested_by, created_at')
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
    }
    return { ...suggestion, sourceLabel: suggestionSourceLabel(suggestion) }
  })
}

async function setSuggestionStatus(suggestion, status) {
  const { error } = await supabase.rpc('respond_to_manager_skill_suggestion', { p_suggestion_id: suggestion.id, p_status: status })
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

const contextKeyOf = (row) => (row.context_type === 'team' ? `team:${row.team_id}` : `organisation:${row.employer_id}`)

// Every target someone else has set for the learner, from either context:
// a linked role profile's required level, the suggested level on an active
// suggestion, and targets in manager_skill_targets. Each carries the
// context it came from, which is also the only context whose rating can
// count it as met (see pickTargetSetByOthers).
export async function listTargetsSetByOthers(userId) {
  const [assignmentsResult, suggestionsResult, targetsResult] = await Promise.all([
    supabase
      .from('employer_role_assignments')
      .select('role_profile_id, employer_member:employer_member_id(employer_id)')
      .eq('status', 'linked'),
    supabase
      .from('manager_skill_suggestions')
      .select('context_type, team_id, employer_id, context_name, skill_library_id, suggested_target_level')
      .eq('learner_id', userId)
      .in('status', ['suggested', 'adopted'])
      .not('suggested_target_level', 'is', null),
    supabase
      .from('manager_skill_targets')
      .select('context_type, team_id, employer_id, context_name, skill_id, skill_library_id, target_level')
      .eq('learner_id', userId)
      .eq('status', 'active'),
  ])
  for (const { error } of [assignmentsResult, suggestionsResult, targetsResult]) if (error) throw error

  const targets = []
  for (const row of suggestionsResult.data ?? []) {
    targets.push({ libraryId: row.skill_library_id, skillId: null, level: row.suggested_target_level, contextType: row.context_type, contextKey: contextKeyOf(row), contextName: row.context_name })
  }
  for (const row of targetsResult.data ?? []) {
    targets.push({ libraryId: row.skill_library_id, skillId: row.skill_id, level: row.target_level, contextType: row.context_type, contextKey: contextKeyOf(row), contextName: row.context_name })
  }

  const assignments = assignmentsResult.data ?? []
  if (assignments.length > 0) {
    const employerIdByProfileId = new Map(assignments.map((a) => [a.role_profile_id, a.employer_member?.employer_id]))
    const employerIds = [...new Set([...employerIdByProfileId.values()].filter(Boolean))]
    const [requirementsResult, organisationsResult] = await Promise.all([
      supabase
        .from('employer_role_profile_skills')
        .select('role_profile_id, library_skill_id, target_level')
        .in('role_profile_id', [...employerIdByProfileId.keys()]),
      supabase.from('organisations').select('id, name').in('id', employerIds),
    ])
    if (requirementsResult.error) throw requirementsResult.error
    const nameById = new Map((organisationsResult.data ?? []).map((o) => [o.id, o.name]))
    for (const row of requirementsResult.data ?? []) {
      const employerId = employerIdByProfileId.get(row.role_profile_id)
      if (!employerId || row.target_level == null) continue
      targets.push({ libraryId: row.library_skill_id, skillId: null, level: row.target_level, contextType: 'organisation', contextKey: `organisation:${employerId}`, contextName: nameById.get(employerId) ?? 'Your organisation' })
    }
  }
  return targets
}

// The learner's latest rating per context and skill, from either context.
// Keys: "<contextKey>|<libraryId>" and "<contextKey>|skill:<skillId>".
export async function listLatestManagerRatings(userId) {
  const { data, error } = await supabase
    .from('manager_skill_ratings')
    .select('context_type, team_id, employer_id, skill_id, skill_library_id, level, rated_at')
    .eq('learner_id', userId)
    .order('rated_at', { ascending: false })
  if (error) throw error
  const latest = new Map()
  for (const row of data ?? []) {
    for (const key of [row.skill_library_id && `${contextKeyOf(row)}|${row.skill_library_id}`, row.skill_id && `${contextKeyOf(row)}|skill:${row.skill_id}`]) {
      if (key && !latest.has(key)) latest.set(key, row.level)
    }
  }
  return latest
}

// The one target set by someone else that applies to this skill: a target
// counts as met only once a rating from its own context reaches it. The
// highest unmet target wins; if every one is met, the highest is returned
// (met), so the learner's own higher target can take over -- see
// computeVisibleTarget.
export function pickTargetSetByOthers({ libraryId, skillId }, targets, latestRatings) {
  const relevant = targets.filter((t) => (libraryId && t.libraryId === libraryId) || (skillId && t.skillId === skillId))
  if (relevant.length === 0) return null
  const scored = relevant.map((t) => {
    const rating = (libraryId && latestRatings.get(`${t.contextKey}|${libraryId}`)) ?? (skillId && latestRatings.get(`${t.contextKey}|skill:${skillId}`)) ?? null
    return { ...t, met: rating != null && rating >= t.level }
  })
  const byLevel = (a, b) => b.level - a.level
  const unmet = scored.filter((t) => !t.met).sort(byLevel)
  const chosen = unmet[0] ?? scored.sort(byLevel)[0]
  return { level: chosen.level, met: chosen.met, contextType: chosen.contextType, contextName: chosen.contextName }
}
