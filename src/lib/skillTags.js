import { supabase } from './supabaseClient'

// Learner-facing: excludes tags a platform admin has blacklisted (see
// AdminTags) so they can't be picked or suggested for new skills.
export async function listTags() {
  const { data, error } = await supabase
    .from('tags')
    .select('id, name')
    .eq('is_blacklisted', false)
    .order('name')
    .limit(500)
  if (error) throw error
  return data ?? []
}

// Case-insensitive exact-name match: reuse the existing shared tag if one
// exists, otherwise add a new one. Mirrors findOrCreateLibrarySkill.
export async function findOrCreateTag(name, userId) {
  const trimmed = name.trim()
  const { data: existing } = await supabase
    .from('tags')
    .select('id')
    .ilike('name', trimmed)
    .eq('is_blacklisted', false)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await supabase
    .from('tags')
    .insert({ name: trimmed, created_by: userId })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') {
      // Re-apply the same not-blacklisted filter as the initial lookup
      // above -- without it, a name collision with a platform-admin-
      // blacklisted tag (0066) would silently resolve to and reuse that
      // moderated row, bypassing the blacklist entirely.
      const { data: retry } = await supabase
        .from('tags')
        .select('id')
        .ilike('name', trimmed)
        .eq('is_blacklisted', false)
        .limit(1)
        .maybeSingle()
      if (retry) return retry.id
      throw new Error(
        `The tag "${trimmed}" already exists but has been blacklisted. Contact support if you believe this is a mistake.`
      )
    }
    throw error
  }
  return data.id
}

export async function listSkillTags(skillId) {
  const { data, error } = await supabase
    .from('skill_tags')
    .select('id, tag_id, tags(id, name)')
    .eq('skill_id', skillId)
  if (error) throw error
  return data ?? []
}

// Finds-or-creates the named tag, then links it to the skill (no-op if
// already linked).
export async function addTagToSkill(userId, skillId, tagName) {
  const tagId = await findOrCreateTag(tagName, userId)
  const { error } = await supabase
    .from('skill_tags')
    .insert({ user_id: userId, skill_id: skillId, tag_id: tagId })
  if (error && error.code !== '23505') throw error
}

export async function removeSkillTagLink(skillTagLinkId) {
  const { error } = await supabase.from('skill_tags').delete().eq('id', skillTagLinkId)
  if (error) throw error
}

// AI-suggested tags for a skill name, preferring reuse of tags that
// already exist. Purely a suggestion — nothing is applied until the user
// clicks a suggested chip.
export async function suggestTags(skillName, existingTags) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const res = await fetch('/api/suggest-tags', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ skillName, existingTags }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to suggest tags.')
  }
  const data = await res.json()
  return data.tags ?? []
}
