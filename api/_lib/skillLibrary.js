import { createClient } from '@supabase/supabase-js'

// AI content cached on a shared skill_library row (level guides, diagnostic
// quizzes, interview plans) is reused by every learner tracking that skill,
// so it must be generated from the library entry's own name -- never a
// client-supplied one, or one learner could shape what everyone else sees.
//
// Read as the caller (their JWT, normal RLS) so the "may they see this
// library entry at all" rule stays the database's single source of truth.
// Returns null when the entry doesn't exist or isn't visible to them.
export async function readableLibrarySkillName(accessToken, librarySkillId) {
  if (typeof librarySkillId !== 'string' || !librarySkillId) return null
  const asUser = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await asUser.from('skill_library').select('name').eq('id', librarySkillId).maybeSingle()
  if (error) throw error
  return data?.name ?? null
}
