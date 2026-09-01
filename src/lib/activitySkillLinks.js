import { supabase } from './supabaseClient'

// Records which skills a logged activity relates to. xapi_statements.skill_id
// stays set to the first (primary) skill for every existing query/index that
// reads it directly; this table is the full set, primary included, so
// fetchStatementsForSkill below can find an activity through ANY of its
// related skills, not just the primary.
export async function insertStatementSkillLinks(userId, statementId, skillIds) {
  const uniqueIds = [...new Set(skillIds)]
  if (uniqueIds.length === 0) return
  const { error } = await supabase.from('xapi_statement_skills').insert(
    uniqueIds.map((skillId) => ({ user_id: userId, statement_id: statementId, skill_id: skillId }))
  )
  if (error && error.code !== '23505') throw error
}

// Every xapi_statements row related to a skill -- whether it's the row's
// primary skill_id or only a secondary related skill -- merged and sorted
// most-recent-first. Used wherever a skill's own page/count needs to include
// activities logged against it alongside other skills, not just the ones
// where it happened to be picked first.
//
// Deliberately scoped by skill_id alone, not the caller's own user id: RLS
// on both tables already grants access either as the activity's owner or
// (xapi_statement_skills' validator policy, mirroring xapi_statements'
// own) as someone validating this skill, and a validator reviewing
// evidence is not the row's owner -- see ValidateRequest.jsx.
export async function fetchStatementsForSkill(skillId, columns = '*') {
  const [{ data: primary, error: primaryError }, { data: links, error: linksError }] = await Promise.all([
    supabase.from('xapi_statements').select(columns).eq('skill_id', skillId),
    supabase.from('xapi_statement_skills').select('statement_id').eq('skill_id', skillId),
  ])
  if (primaryError) throw primaryError
  if (linksError) throw linksError

  const primaryRows = primary ?? []
  const primaryIds = new Set(primaryRows.map((row) => row.id))
  const secondaryIds = [...new Set((links ?? []).map((link) => link.statement_id))].filter(
    (id) => !primaryIds.has(id)
  )

  let secondaryRows = []
  if (secondaryIds.length > 0) {
    const { data, error } = await supabase.from('xapi_statements').select(columns).in('id', secondaryIds)
    if (error) throw error
    secondaryRows = data ?? []
  }

  return [...primaryRows, ...secondaryRows].sort(
    (a, b) => new Date(b.recorded_at) - new Date(a.recorded_at)
  )
}
