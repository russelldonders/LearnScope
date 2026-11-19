// Activities logged in a connection's context (0322): something you did
// together ("joint"), something you saw them do ("observed"), and ratings you
// gave them ("rated"). Each is the logger's own record, tagged with the other
// person; both of you see it on each other's page, and joint/observed ones are
// offered to the other person to add to their own record.
import { supabase } from './supabaseClient'
import { saveActivity } from './activitySkillLinks'
import { buildStatement, durationMinutes } from './xapiStatement'
import { localDateString, dateToTimestamp } from './skillGoalProgress'

export const SHARED_KINDS = ['joint', 'observed']

let nextKey = 0

// The reader's answer as cards: done together on your own skills, or what
// they did on theirs. Positions map back to the lists that were sent.
export function sharedCardsFromDraft(draft, mySkills, theirSkills) {
  return (draft.activities ?? []).map((activity) => ({
    key: `shared-${(nextKey += 1)}`,
    kind: activity.done_by === 'them' ? 'observed' : 'joint',
    title: activity.title,
    date: activity.date,
    durationMinutes: activity.duration_minutes != null ? String(activity.duration_minutes) : '',
    verb: activity.verb,
    mySkills: (activity.skills ?? []).map((index) => mySkills[index]).filter(Boolean),
    theirSkills: (activity.their_skills ?? []).map((index) => theirSkills[index]).filter(Boolean),
    note: activity.note ?? '',
  }))
}

// A date picked in the form means that day; today keeps the actual time.
function cardTimestamp(date) {
  return date === localDateString() ? new Date().toISOString() : dateToTimestamp(date)
}

// Checks one card from the connection's log. Returns an error key or null.
export function sharedCardProblem(card) {
  if (!card.title.trim()) return 'quickLog.errorTitle'
  if (!card.date || card.date > localDateString()) return 'quickLog.errorDate'
  const minutes = card.durationMinutes.trim() === '' ? 0 : Number(card.durationMinutes)
  if (!Number.isInteger(minutes) || minutes < 0) return 'quickLog.errorDuration'
  if (!SHARED_KINDS.includes(card.kind)) return 'sharedActivity.errorKind'
  return null
}

// What a card saves on the logger's own record. Done together, it's their
// activity on their own skills. Seen them do it, it isn't the logger's
// practice at all, so it links none of their skills: the skills named are the
// other person's, kept (by library id) for when they add it.
export function sharedCardStatement(card, { actor, connection }) {
  const minutes = card.durationMinutes.trim() === '' ? 0 : Number(card.durationMinutes)
  const joint = card.kind === 'joint'
  const skills = joint ? card.mySkills : card.theirSkills
  const statement = buildStatement({
    actor,
    verbValue: card.verb || 'experienced',
    activityName: card.title.trim(),
    description: card.note.trim() || null,
    timestamp: cardTimestamp(card.date),
    relatedSkills: joint ? card.mySkills.map((skill) => ({ id: skill.id, name: skill.name })) : [],
    durationHours: Math.floor(minutes / 60),
    durationMinutes: minutes % 60,
    sharedWith: {
      name: connection.name,
      kind: card.kind,
      skills: skills.map((skill) => ({ libraryId: skill.library_skill_id ?? null, name: skill.name })),
    },
  })
  return { statement, skillIds: joint ? card.mySkills.map((skill) => skill.id) : [] }
}

export async function saveSharedCard(card, { userId, actor, connection }) {
  const { statement, skillIds } = sharedCardStatement(card, { actor, connection })
  return saveActivity({
    userId,
    statement,
    evidence: null,
    skillIds,
    sharedWith: { userId: connection.id, kind: card.kind },
  })
}

// Everything either of you logged with or about the other, newest first.
export async function listSharedActivities(userId) {
  const { data, error } = await supabase.rpc('list_shared_activities', { p_user_id: userId })
  if (error) throw error
  return data ?? []
}

// Activities connections logged with or about you, waiting for an answer.
export async function listSharedActivitySuggestions() {
  const { data, error } = await supabase.rpc('list_shared_activity_suggestions')
  if (error) throw error
  return data ?? []
}

// Your own skills that match the ones named on a shared activity.
export function matchingSkills(row, mySkills) {
  const named = Array.isArray(row.skills) ? row.skills : []
  const libraryIds = new Set(named.map((skill) => (typeof skill?.libraryId === 'string' ? skill.libraryId : null)).filter(Boolean))
  return mySkills.filter((skill) => skill.library_skill_id && libraryIds.has(skill.library_skill_id))
}

// The copy that goes on your own record when you add a shared activity: your
// activity, on your matching skills, saying who logged it and how.
export function sharedCopyStatement(row, { actor, loggedByName, mySkills }) {
  const skills = matchingSkills(row, mySkills)
  const minutes = durationMinutes({ result: { duration: row.duration } })
  return {
    statement: buildStatement({
      actor,
      verbValue: 'experienced',
      activityName: row.title || 'Activity',
      description: row.note || null,
      timestamp: row.happened_at,
      relatedSkills: skills.map((skill) => ({ id: skill.id, name: skill.name })),
      durationHours: Math.floor(minutes / 60),
      durationMinutes: minutes % 60,
      sharedWith: {
        name: loggedByName,
        kind: row.kind,
        skills: (Array.isArray(row.skills) ? row.skills : [])
          .filter((skill) => typeof skill?.name === 'string')
          .map((skill) => ({ libraryId: typeof skill.libraryId === 'string' ? skill.libraryId : null, name: skill.name })),
        addedFrom: true,
      },
    }),
    skillIds: skills.map((skill) => skill.id),
  }
}

export async function addSharedActivity(row, { actor, loggedByName, mySkills }) {
  const { statement, skillIds } = sharedCopyStatement(row, { actor, loggedByName, mySkills })
  const { data, error } = await supabase.rpc('respond_to_shared_activity', {
    p_statement_id: row.id,
    p_add: true,
    p_statement: statement,
    p_skill_ids: skillIds,
  })
  if (error) throw error
  return data
}

export async function dismissSharedActivity(row) {
  const { error } = await supabase.rpc('respond_to_shared_activity', { p_statement_id: row.id, p_add: false })
  if (error) throw error
}
