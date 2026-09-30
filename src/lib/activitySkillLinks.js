import { supabase } from './supabaseClient'
import { uploadEvidenceFiles } from './skillEvidence'

// Saves one logged activity with everything that hangs off it: the statement
// row (primary skill + optional experience), its full related-skill links,
// and any evidence files. The single path every "record activity" surface
// uses, so they can't drift apart.
export async function saveActivity({ userId, statement, evidence, skillIds, experienceId = null }) {
  const primarySkillId = skillIds[0] ?? null
  const { data, error } = await supabase
    .from('xapi_statements')
    .insert({
      user_id: userId,
      statement,
      recorded_at: statement.timestamp,
      skill_id: primarySkillId,
      experience_id: experienceId,
      evidence_url: evidence?.evidenceUrl || null,
    })
    .select()
    .single()
  if (error) throw error
  await insertStatementSkillLinks(userId, data.id, skillIds)
  if (evidence?.files?.length > 0) {
    // Evidence is filed under the primary skill so validators of that skill
    // can see it; an activity with no skill keeps it in the owner's own area.
    const paths = await uploadEvidenceFiles(userId, primarySkillId ?? 'unlinked', data.id, evidence.files)
    const { error: updateError } = await supabase.from('xapi_statements').update({ evidence_paths: paths }).eq('id', data.id)
    if (updateError) throw updateError
  }
  return data
}

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
