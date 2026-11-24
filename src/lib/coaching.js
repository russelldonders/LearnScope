import { supabase } from './supabaseClient'

// Coaching on a skill (20261124100000_0335_skill_coaching.sql): a learner
// whose skill another person validated can offer coaching on it; others with
// the same skill find them in Find an expert and ask; the coach accepts or
// declines; either can end it later, and it stays as history. A learner who
// finds no coach can say they're looking for one. The database checks who
// may do what; this only offers the choices.

// Statuses still in play, as against history.
export const OPEN_COACHING_STATUSES = ['requested', 'active']

export async function setOfferCoaching(skillId, offer) {
  const { error } = await supabase.from('skills').update({ offer_coaching: offer }).eq('id', skillId)
  if (error) throw error
}

// The caller's coaching, both as learner ('learner') and as coach ('coach'),
// newest first.
export async function listMyCoaching() {
  const { data, error } = await supabase.rpc('list_my_coaching')
  if (error) throw error
  return data ?? []
}

// Theirs on one skill: as the learner, on their skill; as the coach, on the
// skill they coach from.
export function coachingOnSkill(rows, skillId) {
  return {
    asLearner: rows.filter((row) => row.role === 'learner' && row.learner_skill_id === skillId),
    asCoach: rows.filter((row) => row.role === 'coach' && row.coach_skill_id === skillId),
  }
}

export async function requestCoaching(learnerSkillId, coachSkillId, message = '') {
  const { data, error } = await supabase.rpc('request_coaching', {
    p_learner_skill_id: learnerSkillId,
    p_coach_skill_id: coachSkillId,
    p_message: message?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function respondToCoachingRequest(relationshipId, accept) {
  const { error } = await supabase.rpc('respond_to_coaching_request', { p_relationship_id: relationshipId, p_accept: accept })
  if (error) throw error
}

export async function withdrawCoachingRequest(relationshipId) {
  const { error } = await supabase.rpc('withdraw_coaching_request', { p_relationship_id: relationshipId })
  if (error) throw error
}

export async function endCoaching(relationshipId) {
  const { error } = await supabase.rpc('end_coaching', { p_relationship_id: relationshipId })
  if (error) throw error
}

// How many others offer coaching on a library skill.
export async function countSkillCoaches(librarySkillId) {
  const { data, error } = await supabase.rpc('count_skill_coaches', { p_library_skill_id: librarySkillId })
  if (error) throw error
  return data ?? 0
}

// "Looking for a coach": the learner's own, one per skill.
export async function listMyCoachInterests() {
  const { data, error } = await supabase.rpc('list_my_coach_interests')
  if (error) throw error
  return data ?? []
}

export async function registerCoachInterest(userId, skillId) {
  const { error } = await supabase.from('coach_interests').insert({ user_id: userId, skill_id: skillId })
  if (error) throw error
}

export async function withdrawCoachInterest(skillId) {
  const { error } = await supabase.from('coach_interests').delete().eq('skill_id', skillId)
  if (error) throw error
}
