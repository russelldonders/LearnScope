import { createClient } from '@supabase/supabase-js'

// Service-role client for the one write path that needs to bypass RLS on
// purpose: caching AI-generated diagnostic content that's shared/reused
// across every learner, not owned by any single user. Never expose this
// key to the client bundle -- it must only ever be read from
// process.env inside a serverless function, never via import.meta.env.
export function supabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(supabaseUrl, serviceRoleKey)
}
