import { createClient } from '@supabase/supabase-js'

// Run by .github/workflows/release-platform-version.yml on every push to
// master -- the automated counterpart to what the "Confirm release" button
// on the platform admin console (/admin/releases) used to do by hand (see
// that page's own comment, and CLAUDE.md's release checklist step 4, for
// the manual process this replaces).
//
// Staging accumulates changelog entries one at a time during development
// (release_id null = pending); this script bundles whatever is currently
// pending into a new numbered release on Staging, then mirrors the exact
// same entries and version number onto Production as an already-released
// batch -- Production never carries its own pending backlog under this
// workflow. Both environments are separate Supabase projects with no
// built-in sync (see CLAUDE.md section 17), so this script is what keeps
// their release histories and version numbers in lockstep instead of a
// human re-typing the same entries into both admin consoles.
//
// Calls system_confirm_platform_release (20260922090000 migration), not
// the human-facing confirm_platform_release RPC -- that one gates on
// is_platform_admin(auth.uid()), which is meaningless for a service-role
// caller with no user JWT. This script authenticates with each project's
// service-role key instead, and system_confirm_platform_release's own
// GRANT restricts it to service_role only.
//
// Required environment variables (set as GitHub Actions secrets):
//   SUPABASE_STAGING_URL, SUPABASE_STAGING_SERVICE_ROLE_KEY
//   SUPABASE_PRODUCTION_URL, SUPABASE_PRODUCTION_SERVICE_ROLE_KEY

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function client(urlVar, keyVar) {
  return createClient(requireEnv(urlVar), requireEnv(keyVar), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function highestVersion(supabase, label) {
  const { data, error } = await supabase
    .from('platform_releases')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw new Error(`${label}: failed to read platform_releases (${error.message})`)
  return data?.[0]?.version ?? 0
}

async function pendingEntrySummaries(supabase) {
  const { data, error } = await supabase
    .from('platform_changelog_entries')
    .select('summary, created_at')
    .is('release_id', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Staging: failed to read pending changelog entries (${error.message})`)
  return (data ?? []).map((entry) => entry.summary)
}

async function main() {
  const staging = client('SUPABASE_STAGING_URL', 'SUPABASE_STAGING_SERVICE_ROLE_KEY')
  const production = client('SUPABASE_PRODUCTION_URL', 'SUPABASE_PRODUCTION_SERVICE_ROLE_KEY')

  const summaries = await pendingEntrySummaries(staging)
  if (summaries.length === 0) {
    console.log('No pending Staging changelog entries -- nothing to release, skipping.')
    return
  }

  // Self-healing: base the next number on whichever environment is
  // further ahead, so a prior partial failure (e.g. Staging released but
  // Production's mirror failed) can't quietly reuse or skip a version
  // number on the next push.
  const nextVersion = Math.max(await highestVersion(staging, 'Staging'), await highestVersion(production, 'Production')) + 1

  console.log(`Bundling ${summaries.length} pending entr${summaries.length === 1 ? 'y' : 'ies'} into version ${nextVersion}…`)

  const { error: stagingError } = await staging.rpc('system_confirm_platform_release', {
    p_version: nextVersion,
    p_notes: null,
    p_entry_summaries: null,
  })
  if (stagingError) throw new Error(`Staging: system_confirm_platform_release failed (${stagingError.message})`)

  const { error: productionError } = await production.rpc('system_confirm_platform_release', {
    p_version: nextVersion,
    p_notes: null,
    p_entry_summaries: summaries,
  })
  if (productionError) {
    throw new Error(
      `Production: system_confirm_platform_release failed (${productionError.message}) -- ` +
        `Staging is now on version ${nextVersion} but Production is not; this needs manual reconciliation.`
    )
  }

  console.log(`Released version ${nextVersion} on both Staging and Production.`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
