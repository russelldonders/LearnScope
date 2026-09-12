import { supabase } from '../supabaseClient'

// Unreleased "What's new" entries -- the running list that builds up on
// staging until the next confirmed release bundles them.
export async function listPendingChangelogEntries() {
  const { data, error } = await supabase
    .from('platform_changelog_entries')
    .select('id, summary, created_at')
    .is('release_id', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function addChangelogEntry(summary) {
  const { error } = await supabase.from('platform_changelog_entries').insert({ summary: summary.trim() })
  if (error) throw error
}

// Only a still-pending entry can be edited/removed -- prevent_released_
// changelog_entry_mutation (20260913150000) blocks this server-side too
// once an entry is part of a shipped release.
export async function updateChangelogEntry(id, summary) {
  const { error } = await supabase.from('platform_changelog_entries').update({ summary: summary.trim() }).eq('id', id)
  if (error) throw error
}

export async function deleteChangelogEntry(id) {
  const { error } = await supabase.from('platform_changelog_entries').delete().eq('id', id)
  if (error) throw error
}

// Every past release, newest first, each with its own bundled entries --
// the platform admin console's release history.
export async function listPlatformReleases() {
  const { data, error } = await supabase
    .from('platform_releases')
    .select('id, version, notes, released_at, platform_changelog_entries(id, summary, created_at)')
    .order('version', { ascending: false })
  if (error) throw error
  return (data ?? []).map((release) => ({
    id: release.id,
    version: release.version,
    notes: release.notes,
    releasedAt: release.released_at,
    entries: (release.platform_changelog_entries ?? [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  }))
}

export async function getNextSuggestedVersion() {
  const { data, error } = await supabase
    .from('platform_releases')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data?.[0]?.version ?? 0) + 1
}

export async function confirmPlatformRelease(version, notes) {
  const { data, error } = await supabase.rpc('confirm_platform_release', {
    p_version: version,
    p_notes: notes?.trim() || null,
  })
  if (error) throw error
  return data
}
