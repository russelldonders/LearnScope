import { supabase } from './supabaseClient'

// Records the first time a learner successfully runs the CV/history import
// (from either the onboarding wizard or /profile/import) -- drives the
// dashboard's "import your CV/history" banner, which hides once this is
// set. .is('cv_imported_at', null) keeps it a true "first import" date: a
// later re-import won't overwrite it.
export async function markCvImported(userId) {
  await supabase
    .from('profiles')
    .update({ cv_imported_at: new Date().toISOString() })
    .eq('id', userId)
    .is('cv_imported_at', null)
}
