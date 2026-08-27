import { supabase } from './supabaseClient'
import { listIncomingRateInvites } from './connections'

// Which top-nav links are worth showing a brand-new learner -- Skills/
// Learning/Connections are hidden until there's actually something behind
// them, so a first-time dashboard stays focused on the one useful action
// (add a skill) instead of a full nav bar of empty pages. Connections counts
// as "something behind it" the moment there's an accepted connection or any
// pending request/invite in either direction, not just accepted connections,
// since a request the learner still needs to act on is exactly the kind of
// thing this tab exists to surface.
export async function getNavVisibility(userId) {
  const [
    { count: skillsCount },
    { count: coursesCount },
    { count: connectionsCount },
    { count: pendingRequestCount },
    rateInvites,
  ] = await Promise.all([
    supabase.from('skills').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('courses').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('connections')
      .select('user_a_id', { count: 'exact', head: true })
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`),
    supabase
      .from('connection_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`),
    listIncomingRateInvites(),
  ])
  return {
    hasSkills: (skillsCount ?? 0) > 0,
    hasCourses: (coursesCount ?? 0) > 0,
    hasConnectionsActivity: (connectionsCount ?? 0) > 0 || (pendingRequestCount ?? 0) > 0 || rateInvites.length > 0,
  }
}
