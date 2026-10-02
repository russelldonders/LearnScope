import { supabase } from './supabaseClient'

function throwIfError(error) {
  if (error) throw error
}

// The learner's development targets, kept in two groups: their own (the
// latest skill_targets row per skill they set themselves) and targets set
// for them by someone else -- a team manager or an organisation -- from
// manager_skill_targets, which belong to that context. Rows a team manager
// wrote into skill_targets before the merge are excluded from "own" here;
// their copy in manager_skill_targets is what's shown.
export async function listMySkillDevelopmentTargets(userId) {
  const [{ data: personalRows, error: personalError }, { data: otherRows, error: otherError }] = await Promise.all([
    supabase
      .from('skill_targets')
      .select('id, skill_id, target_level, target_date, comments, created_at, skills!inner(id, name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('manager_skill_targets')
      .select('id, context_type, team_id, employer_id, context_name, skill_id, skill_library_id, target_level, target_date, notes, status, created_at, closed_at, skill_library(name), skills(name)')
      .eq('learner_id', userId)
      .order('created_at', { ascending: false }),
  ])
  throwIfError(personalError)
  throwIfError(otherError)

  const latestPersonalBySkill = new Map()
  for (const row of personalRows ?? []) {
    if (!latestPersonalBySkill.has(row.skill_id)) {
      latestPersonalBySkill.set(row.skill_id, {
        id: row.id,
        ownership: 'personal',
        skillId: row.skill_id,
        skillName: row.skills?.name ?? 'Skill',
        targetLevel: Number(row.target_level),
        targetDate: row.target_date,
        notes: row.comments,
        createdAt: row.created_at,
      })
    }
  }

  // ownership 'employer' (kept for the existing UI) now means "set by
  // someone else"; contextType says whether that was a team or an
  // organisation, and employerName carries that context's name.
  const employer = (otherRows ?? []).map((row) => ({
    id: row.id,
    ownership: 'employer',
    contextType: row.context_type,
    employerId: row.employer_id,
    teamId: row.team_id,
    employerName: row.context_name,
    skillId: row.skill_id,
    skillLibraryId: row.skill_library_id,
    skillName: row.skills?.name ?? row.skill_library?.name ?? 'Skill',
    targetLevel: Number(row.target_level),
    targetDate: row.target_date,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  }))

  return {
    personal: [...latestPersonalBySkill.values()],
    employer,
  }
}
