import { supabase } from './supabaseClient'

// Data for the LearnScope panels an organisation can put on its own
// learner-workspace pages (PANEL_BLOCKS in pageBuilder.js). Each panel shows
// the signed-in member their own records, and only those that belong to
// this organisation: goals and ratings set in the organisation's own context
// (manager_skill_targets / manager_skill_ratings with its employer_id).
// Team goals carry no organisation, so they aren't shown. Nothing from the
// rest of the member's LearnScope record is shown, and nothing is written.

// Every query below filters on the member's own id (learner_id / user_id).
// Keep it: RLS also lets an organisation admin read the organisation's
// ratings of colleagues, so for an admin who is also a member it is that
// filter, not RLS, that keeps the panels to their own records.

export function belongsToOrganisation(row, organisationId) {
  return Boolean(organisationId) && row.context_type === 'organisation' && row.employer_id === organisationId
}

async function listMyCurrentSkills(userId) {
  const { data, error } = await supabase
    .from('skills')
    .select('id, name, level, library_skill_id')
    .eq('user_id', userId)
    .or('lifecycle_stage.is.null,lifecycle_stage.neq.archived')
  if (error) throw error
  return data ?? []
}

// The member's own skill a goal or rating is about: the skill row itself,
// or their skill linked to the same library skill.
function findOwnSkill(row, skills) {
  return skills.find((skill) => (row.skill_id && skill.id === row.skill_id)
    || (row.skill_library_id && skill.library_skill_id === row.skill_library_id)) ?? null
}

function skillNameOf(row, ownSkill) {
  return row.skills?.name ?? row.skill_library?.name ?? ownSkill?.name ?? null
}

// Goals the organisation set for the member, soonest due first. `show`
// 'active' keeps open goals; 'all' adds completed ones. Cancelled and
// replaced goals are never shown.
export function shapeOrganisationGoals(rows, skills, organisationId, { show = 'active', limit = 5 } = {}) {
  const statuses = show === 'all' ? ['active', 'completed'] : ['active']
  return rows
    .filter((row) => belongsToOrganisation(row, organisationId) && statuses.includes(row.status))
    .map((row) => {
      const ownSkill = findOwnSkill(row, skills)
      return {
        id: row.id,
        skillName: skillNameOf(row, ownSkill) ?? 'Skill',
        targetLevel: Number(row.target_level),
        targetDate: row.target_date,
        status: row.status,
        contextName: row.context_name,
        currentLevel: ownSkill?.level ?? null,
      }
    })
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1)
      || String(a.targetDate).localeCompare(String(b.targetDate)))
    .slice(0, limit)
}

export async function listOrganisationGoals(userId, organisationId, options) {
  const [targetsResult, skills] = await Promise.all([
    supabase
      .from('manager_skill_targets')
      .select('id, context_type, employer_id, context_name, skill_id, skill_library_id, target_level, target_date, status, skills(name), skill_library(name)')
      .eq('learner_id', userId)
      .eq('employer_id', organisationId)
      .in('status', ['active', 'completed']),
    listMyCurrentSkills(userId),
  ])
  if (targetsResult.error) throw targetsResult.error
  return shapeOrganisationGoals(targetsResult.data ?? [], skills, organisationId, options)
}

// The member's skills the organisation has rated, confirmed or set a goal
// on, most recent first -- one entry per skill, with the organisation's
// latest rating and open goal for it. The member's own current level is
// shown beside them, labelled as theirs.
export function shapeOrganisationSkills(ratings, targets, skills, organisationId, { limit = 5 } = {}) {
  const bySkill = new Map()
  function entryFor(row) {
    const ownSkill = findOwnSkill(row, skills)
    const key = ownSkill ? `skill:${ownSkill.id}` : row.skill_library_id ? `library:${row.skill_library_id}` : `skill:${row.skill_id}`
    if (!bySkill.has(key)) {
      bySkill.set(key, {
        key,
        skillName: skillNameOf(row, ownSkill) ?? 'Skill',
        currentLevel: ownSkill?.level ?? null,
        ratedLevel: null,
        ratedAt: null,
        goalLevel: null,
        latestAt: null,
      })
    }
    return bySkill.get(key)
  }
  const later = (a, b) => (!a || (b && b > a) ? b : a)
  for (const row of ratings) {
    if (!belongsToOrganisation(row, organisationId)) continue
    const entry = entryFor(row)
    if (!entry.ratedAt || row.rated_at > entry.ratedAt) {
      entry.ratedLevel = Number(row.level)
      entry.ratedAt = row.rated_at
    }
    entry.latestAt = later(entry.latestAt, row.rated_at)
  }
  for (const row of targets) {
    if (!belongsToOrganisation(row, organisationId) || row.status !== 'active') continue
    const entry = entryFor(row)
    entry.goalLevel = Math.max(entry.goalLevel ?? 0, Number(row.target_level))
    entry.latestAt = later(entry.latestAt, row.created_at)
  }
  return [...bySkill.values()]
    .sort((a, b) => String(b.latestAt).localeCompare(String(a.latestAt)))
    .slice(0, limit)
}

export async function listOrganisationSkills(userId, organisationId, options) {
  const [ratingsResult, targetsResult, skills] = await Promise.all([
    supabase
      .from('manager_skill_ratings')
      .select('context_type, employer_id, skill_id, skill_library_id, level, rated_at, skills(name), skill_library(name)')
      .eq('learner_id', userId)
      .eq('employer_id', organisationId)
      .order('rated_at', { ascending: false }),
    supabase
      .from('manager_skill_targets')
      .select('context_type, employer_id, skill_id, skill_library_id, target_level, status, created_at, skills(name), skill_library(name)')
      .eq('learner_id', userId)
      .eq('employer_id', organisationId)
      .eq('status', 'active'),
    listMyCurrentSkills(userId),
  ])
  for (const { error } of [ratingsResult, targetsResult]) if (error) throw error
  return shapeOrganisationSkills(ratingsResult.data ?? [], targetsResult.data ?? [], skills, organisationId, options)
}
