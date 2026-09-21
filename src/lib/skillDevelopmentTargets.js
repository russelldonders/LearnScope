import { supabase } from './supabaseClient'

function throwIfError(error) {
  if (error) throw error
}

export async function listMySkillDevelopmentTargets(userId) {
  const [{ data: personalRows, error: personalError }, { data: employerRows, error: employerError }] = await Promise.all([
    supabase
      .from('skill_targets')
      .select('id, skill_id, target_level, target_date, comments, created_at, skills!inner(id, name)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase.rpc('list_my_employer_skill_development_targets'),
  ])
  throwIfError(personalError)
  throwIfError(employerError)

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

  const employer = (employerRows ?? []).map((row) => ({
    id: row.id,
    ownership: 'employer',
    employerId: row.employer_id,
    employerName: row.employer_name,
    employerMemberId: row.employer_member_id,
    skillLibraryId: row.skill_library_id,
    skillName: row.skill_name,
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
