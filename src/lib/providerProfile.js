import { supabase } from './supabaseClient'

// Backs the public /providers/:slug page -- reachable logged-out (Rate.jsx
// is the only other page that works this way), so this calls the
// get_provider_profile RPC (0090) rather than querying organisations/
// course_catalogue/organisation_offered_skills directly, since those
// tables' RLS is authenticated-only. Returns null if the slug doesn't
// exist, the organisation is inactive, or it hasn't opted into
// public_profile_enabled -- those three cases are deliberately
// indistinguishable to the caller.
export async function getProviderProfile(slug) {
  const { data, error } = await supabase.rpc('get_provider_profile', { p_slug: slug })
  if (error) throw error
  return data?.organisation ? data : null
}
