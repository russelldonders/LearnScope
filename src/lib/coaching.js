import { supabase } from './supabaseClient'
import { saveActivity } from './activitySkillLinks'
import { buildStatement } from './xapiStatement'

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

// -- Sessions (20261124140000_0336_coaching_sessions.sql) --

export const SESSION_LENGTHS = [15, 30, 45, 60, 90, 120]
export const PLANNED_SESSION_STATUSES = ['proposed', 'confirmed']

// Every session in the caller's coaching, as learner or coach, by start time.
export async function listMyCoachingSessions() {
  const { data, error } = await supabase.rpc('list_my_coaching_sessions')
  if (error) throw error
  return data ?? []
}

export async function proposeCoachingSession(relationshipId, { startsAt, durationMinutes, location = '', agenda = '' }) {
  const { data, error } = await supabase.rpc('propose_coaching_session', {
    p_relationship_id: relationshipId,
    p_starts_at: startsAt,
    p_duration_minutes: durationMinutes,
    p_location: location?.trim() || null,
    p_agenda: agenda?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function respondToCoachingSession(sessionId, accept) {
  const { error } = await supabase.rpc('respond_to_coaching_session', { p_session_id: sessionId, p_accept: accept })
  if (error) throw error
}

// Another time for a planned session: it's replaced by a new proposal.
export async function rescheduleCoachingSession(sessionId, { startsAt, durationMinutes, location = '', agenda = '' }) {
  const { data, error } = await supabase.rpc('reschedule_coaching_session', {
    p_session_id: sessionId,
    p_starts_at: startsAt,
    p_duration_minutes: durationMinutes,
    p_location: location?.trim() || null,
    p_agenda: agenda?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function cancelCoachingSession(sessionId) {
  const { error } = await supabase.rpc('cancel_coaching_session', { p_session_id: sessionId })
  if (error) throw error
}

// What marking a session done records on the learner's record: something
// they did together with their coach (0322), on the skill they're coached
// in, when the session started and for as long as it lasted.
export function sessionActivityStatement({ session, relationship, actor, title, note = '' }) {
  const minutes = session.duration_minutes
  return buildStatement({
    actor,
    verbValue: 'experienced',
    activityName: title,
    description: note.trim() || session.agenda || null,
    timestamp: session.starts_at,
    relatedSkills: relationship.learner_skill_id ? [{ id: relationship.learner_skill_id, name: relationship.skill_name }] : [],
    durationHours: Math.floor(minutes / 60),
    durationMinutes: minutes % 60,
    sharedWith: {
      name: relationship.other_name,
      kind: 'joint',
      skills: [{ libraryId: relationship.library_skill_id ?? null, name: relationship.skill_name }],
    },
  })
}

// The learner marks a session done: records the activity, then ties the
// session to it. If the session can't be marked done, the activity just
// recorded is taken back so nothing is left half-done. Returns the saved
// activity row.
export async function completeCoachingSession({ session, relationship, userId, actor, title, note = '' }) {
  const statement = sessionActivityStatement({ session, relationship, actor, title, note })
  const row = await saveActivity({
    userId,
    statement,
    evidence: null,
    skillIds: relationship.learner_skill_id ? [relationship.learner_skill_id] : [],
    sharedWith: { userId: relationship.other_user_id, kind: 'joint' },
  })
  const { error } = await supabase.rpc('complete_coaching_session', { p_session_id: session.id, p_statement_id: row.id })
  if (error) {
    await supabase.from('xapi_statements').delete().eq('id', row.id)
    throw error
  }
  return row
}

// The learner's own name, for the activity recorded as theirs.
export async function myDisplayName(userId) {
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return data?.full_name ?? ''
}

// -- Reviews (20261124170000_0337_coach_reviews.sql) --
// Named: shown with the learner's name to anyone looking at the coach for
// that skill while the coach offers coaching on it.

// Each coach's average stars and number of reviews on a library skill.
export async function listCoachRatings(librarySkillId) {
  const { data, error } = await supabase.rpc('list_coach_ratings', { p_library_skill_id: librarySkillId })
  if (error) throw error
  return data ?? []
}

export async function listCoachReviews(coachId, librarySkillId) {
  const { data, error } = await supabase.rpc('list_coach_reviews', { p_coach_id: coachId, p_library_skill_id: librarySkillId })
  if (error) throw error
  return data ?? []
}

// The reviews the learner wrote, by coaching relationship.
export async function listMyCoachReviews(userId) {
  const { data, error } = await supabase
    .from('coach_reviews')
    .select('id, relationship_id, rating, comment, created_at, updated_at')
    .eq('learner_id', userId)
  if (error) throw error
  return data ?? []
}

export async function saveCoachReview(relationshipId, rating, comment = '') {
  const { error } = await supabase.rpc('save_coach_review', {
    p_relationship_id: relationshipId,
    p_rating: rating,
    p_comment: comment?.trim() || null,
  })
  if (error) throw error
}

export async function deleteCoachReview(relationshipId) {
  const { error } = await supabase.rpc('delete_coach_review', { p_relationship_id: relationshipId })
  if (error) throw error
}

// Reviews about the caller as a coach from the last 30 days.
export async function listMyRecentCoachReviews() {
  const { data, error } = await supabase.rpc('list_my_recent_coach_reviews')
  if (error) throw error
  return data ?? []
}
