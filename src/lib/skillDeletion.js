import { supabase } from './supabaseClient'

// Deletes one of the learner's own skills and then the uploaded files that
// went with it. Deleting the skill removes its resources and assessments
// (they cascade), but storage keeps their files, unreachable, unless they're
// removed too. Logged activities are kept when a skill is deleted (their
// skill link is only cleared), so their evidence files stay; an assessment
// file still listed on a kept activity stays as well.
export async function deleteSkillWithFiles(skill, userId) {
  const ownFolder = `${userId}/`
  const [resources, assessments] = await Promise.all([
    supabase.from('skill_resources').select('file_path').eq('skill_id', skill.id).not('file_path', 'is', null),
    supabase.from('skill_assessments').select('evidence_paths').eq('skill_id', skill.id).eq('user_id', userId),
  ])
  if (resources.error) throw resources.error
  if (assessments.error) throw assessments.error
  const resourceFiles = (resources.data ?? []).map((r) => r.file_path).filter((p) => p?.startsWith(ownFolder))
  const evidenceFiles = [...new Set((assessments.data ?? []).flatMap((a) => a.evidence_paths ?? []))]
    .filter((p) => p?.startsWith(ownFolder))

  const { error } = await supabase.from('skills').delete().eq('id', skill.id)
  if (error) throw error

  // The skill is gone either way; a file left behind is only unreachable, so
  // a clean-up failure is logged rather than reported.
  try {
    // A file another of the learner's resources still points at stays.
    let removableResources = resourceFiles
    if (resourceFiles.length > 0) {
      const { data: still, error: stillError } = await supabase
        .from('skill_resources')
        .select('file_path')
        .in('file_path', resourceFiles)
      if (stillError) throw stillError
      const inUse = new Set((still ?? []).map((row) => row.file_path))
      removableResources = resourceFiles.filter((p) => !inUse.has(p))
    }
    let removableEvidence = evidenceFiles
    if (evidenceFiles.length > 0) {
      const { data: kept, error: keptError } = await supabase
        .from('xapi_statements')
        .select('evidence_paths')
        .overlaps('evidence_paths', evidenceFiles)
      if (keptError) throw keptError
      const stillUsed = new Set((kept ?? []).flatMap((row) => row.evidence_paths ?? []))
      removableEvidence = evidenceFiles.filter((p) => !stillUsed.has(p))
    }
    await Promise.all([
      removableResources.length ? supabase.storage.from('skill-resources').remove(removableResources) : null,
      removableEvidence.length ? supabase.storage.from('skill-evidence').remove(removableEvidence) : null,
    ])
  } catch (cleanupError) {
    console.error('Skill deleted, but some of its files could not be removed:', cleanupError)
  }
}
