import { supabase } from '../lib/supabaseClient'

// The one indirection point for reaching Supabase, so a future need to route
// different learners to different regional projects has somewhere to land
// without touching every call site. Today there's only one project, so this
// just returns the existing singleton unchanged -- see docs/data-architecture.md.
export function getDataClient() {
  return supabase
}
