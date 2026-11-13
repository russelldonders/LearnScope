import { supabase } from './supabaseClient'
import { PROVENANCE_EXTENSION_IRI, activityName, durationMinutes } from './xapiStatement'

// What a connected app (identified by its provenance source, e.g. 'strava')
// has contributed to the learner's record: the activities synced from it,
// grouped by the skill each one counts toward. Read-only -- built from the
// activities and their skill links as they stand, so renaming, relinking or
// deleting a skill or activity is reflected here rather than duplicated.
export async function fetchConnectorContributions(userId, source) {
  const { data: statements, error } = await supabase
    .from('xapi_statements')
    .select('id, statement, recorded_at, skill_id')
    .eq('user_id', userId)
    .contains('statement', { context: { extensions: { [PROVENANCE_EXTENSION_IRI]: { source } } } })
  if (error) throw error
  if (!statements?.length) return []

  const [{ data: links, error: linksError }, { data: skills, error: skillsError }] = await Promise.all([
    supabase.from('xapi_statement_skills').select('statement_id, skill_id').eq('user_id', userId),
    supabase.from('skills').select('id, name').eq('user_id', userId),
  ])
  if (linksError) throw linksError
  if (skillsError) throw skillsError

  return groupContributionsBySkill(statements, links ?? [], skills ?? [])
}

// Pure grouping step, split out so it can be tested without a database. An
// activity related to more than one skill is listed under each of them, since
// it counts toward each. Activities whose skill no longer exists are left out
// -- they no longer contribute to any skill.
export function groupContributionsBySkill(statements, links, skills) {
  const skillNames = new Map(skills.map((s) => [s.id, s.name]))
  const linksByStatement = new Map()
  for (const link of links) {
    if (!linksByStatement.has(link.statement_id)) linksByStatement.set(link.statement_id, new Set())
    linksByStatement.get(link.statement_id).add(link.skill_id)
  }

  const groups = new Map()
  for (const row of statements) {
    const skillIds = new Set(linksByStatement.get(row.id) ?? [])
    if (row.skill_id) skillIds.add(row.skill_id)
    const activity = {
      id: row.id,
      name: activityName(row.statement),
      recordedAt: row.recorded_at,
      minutes: durationMinutes(row.statement),
    }
    for (const skillId of skillIds) {
      const name = skillNames.get(skillId)
      if (name === undefined) continue
      if (!groups.has(skillId)) groups.set(skillId, { skillId, skillName: name, activities: [], totalMinutes: 0 })
      const group = groups.get(skillId)
      group.activities.push(activity)
      group.totalMinutes += activity.minutes
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      activities: group.activities.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt)),
    }))
    .sort((a, b) => b.activities.length - a.activities.length || a.skillName.localeCompare(b.skillName))
}
