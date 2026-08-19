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
