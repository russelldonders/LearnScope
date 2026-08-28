import { supabase } from './supabaseClient'

export async function generatePracticalLevelGuide(skillName) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/generate-level-guide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ skillName, axis: 'practical' }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to generate level guidance.')
  }
  const data = await res.json()
  return data.statements ?? []
}

// Mirrors ensureKnowledgeLevelGuide -- generating costs AI credits, so this
// is the one place that decides whether a fresh call is actually needed. The
// guide text only depends on the skill name, so for any skill linked to the
// shared library (skill.library_skill_id) the cache lives on that shared
// skill_library row instead of the learner's own skills row -- every
// learner tracking the same library skill reuses the same generated guide.
// Only a fully custom, unlinked skill falls back to per-instance caching.
export async function ensurePracticalLevelGuide(skill) {
  if (skill.practical_level_guide?.length === 5) return skill.practical_level_guide

  if (skill.library_skill_id) {
    const { data: libRow, error: libError } = await supabase
      .from('skill_library')
      .select('practical_level_guide')
      .eq('id', skill.library_skill_id)
      .maybeSingle()
    if (libError) console.error('Failed to read cached practical level guide:', libError)
    if (libRow?.practical_level_guide?.length === 5) return libRow.practical_level_guide

    const statements = await generatePracticalLevelGuide(skill.name)
    if (statements.length === 5) {
      const { error } = await supabase.rpc('set_skill_library_level_guide', {
        p_skill_library_id: skill.library_skill_id,
        p_axis: 'practical',
        p_statements: statements,
      })
      if (error) console.error('Failed to cache practical level guide:', error)
    }
    return statements
  }

  const statements = await generatePracticalLevelGuide(skill.name)
  if (statements.length === 5) {
    const { error } = await supabase.from('skills').update({ practical_level_guide: statements }).eq('id', skill.id)
    if (error) console.error('Failed to cache practical level guide:', error)
  }
  return statements
}
