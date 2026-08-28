import { supabase } from './supabaseClient'
import { listConnections } from './connections'

// Anonymous platform-wide total -- see 0053_skill_tracker_count.sql for why
// this is a count-only RPC rather than a direct table query.
export async function countSkillTrackers(librarySkillId) {
  if (!librarySkillId) return 0
  const { data, error } = await supabase.rpc('count_skill_trackers', {
    p_library_skill_id: librarySkillId,
  })
  if (error) throw error
  return data ?? 0
}

// Per-level breakdown of the same count -- see 0076's skill_level_stats for
// why this is grouped-count-only too (no user identities, so no privacy
// opt-in needed to expose it, unlike list_skill_matches).
export async function getSkillLevelStats(librarySkillId) {
  if (!librarySkillId) return []
  const { data, error } = await supabase.rpc('skill_level_stats', {
    p_library_skill_id: librarySkillId,
  })
  if (error) throw error
  return data ?? []
}

// Per-knowledge-level self-rated vs assessed breakdown (0092) -- same
// anonymous, count-only shape as getSkillLevelStats, just split by whether
// each tracker's latest knowledge-axis assessment was self-reported or came
// from some other evidence source (course, AI baseline/evaluation, or the
// confirmed diagnostic quiz).
export async function getSkillKnowledgeLevelSourceStats(librarySkillId) {
  if (!librarySkillId) return []
  const { data, error } = await supabase.rpc('skill_knowledge_level_source_stats', {
    p_library_skill_id: librarySkillId,
  })
  if (error) throw error
  return data ?? []
}

// Already-generated (cached) knowledge-check quiz questions for this skill,
// one per level that's ever been generated -- see skill_diagnostic_content
// (0049), populated by api/generate-diagnostic-quiz.js and reused across
// every learner who takes that skill+level's quiz, never regenerated here.
// Multiple prompt_versions can exist if the generation prompt was later
// improved (see PROMPT_VERSION in that endpoint); only the newest version per
// level is shown, since older versions are stale content no longer served.
export async function getSkillDiagnosticQuestions(librarySkillId) {
  if (!librarySkillId) return []
  const { data, error } = await supabase
    .from('skill_diagnostic_content')
    .select('level, prompt_version, content')
    .eq('library_skill_id', librarySkillId)
    .eq('diagnostic_type', 'quiz')
    .eq('axis', 'knowledge')
    .order('level', { ascending: true })
    .order('prompt_version', { ascending: false })
  if (error) throw error
  const byLevel = new Map()
  for (const row of data ?? []) {
    if (!byLevel.has(row.level)) byLevel.set(row.level, row)
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level)
}

// One real, already-generated learner's level-guide text for this library
// skill (see 0083_skill_level_guide_sample.sql for why this has to be an
// RPC rather than a direct `skills` query) -- either field may be null if
// no tracker has generated that axis's guide yet, and the whole result is
// null if nobody's generated either.
export async function getSkillLevelGuideSample(librarySkillId) {
  if (!librarySkillId) return null
  const { data, error } = await supabase.rpc('skill_level_guide_sample', {
    p_library_skill_id: librarySkillId,
  })
  if (error) throw error
  return data?.[0] ?? null
}

// Which of the current user's connections also track this same skill
// (matched via the shared skill_library entry, same identity used for
// validator eligibility elsewhere). Filtering to the connection id list
// first, then relying on the "Connections can view visible skills profiles"
// RLS policy to actually return the row, means a connection only shows up
// here if they've also opted into skills_profile_visible -- same permission
// path as everywhere else this app reveals another learner's skills.
export async function listConnectionsWithSkill(librarySkillId, currentUserId) {
  if (!librarySkillId) return []
  const connections = await listConnections(currentUserId)
  if (connections.length === 0) return []
  const { data, error } = await supabase
    .from('skills')
    .select('user_id')
    .eq('library_skill_id', librarySkillId)
    .in(
      'user_id',
      connections.map((c) => c.id)
    )
  if (error) throw error
  const matchedIds = new Set((data ?? []).map((s) => s.user_id))
  return connections.filter((c) => matchedIds.has(c.id))
}
