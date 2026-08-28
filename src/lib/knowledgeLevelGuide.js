import { supabase } from './supabaseClient'

export async function generateKnowledgeLevelGuide(skillName) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/generate-level-guide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ skillName, axis: 'knowledge' }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to generate level guidance.')
  }
  const data = await res.json()
  return data.statements ?? []
}

// Generating costs AI credits, so this is the one place that decides
// whether a fresh call is actually needed. The guide text only depends on
// the skill name, so for any skill linked to the shared library
// (skill.library_skill_id) the cache lives on that shared skill_library row
// -- every learner tracking the same library skill reuses the same
// generated guide instead of each regenerating their own. Only a fully
// custom, unlinked skill falls back to caching on the learner's own skills
// row, same as before.
export async function ensureKnowledgeLevelGuide(skill) {
  if (skill.knowledge_level_guide?.length === 5) return skill.knowledge_level_guide

  if (skill.library_skill_id) {
    const { data: libRow, error: libError } = await supabase
      .from('skill_library')
      .select('knowledge_level_guide')
      .eq('id', skill.library_skill_id)
      .maybeSingle()
    if (libError) console.error('Failed to read cached knowledge level guide:', libError)
    if (libRow?.knowledge_level_guide?.length === 5) return libRow.knowledge_level_guide

    const statements = await generateKnowledgeLevelGuide(skill.name)
    if (statements.length === 5) {
      const { error } = await supabase.rpc('set_skill_library_level_guide', {
        p_skill_library_id: skill.library_skill_id,
        p_axis: 'knowledge',
        p_statements: statements,
      })
      if (error) console.error('Failed to cache knowledge level guide:', error)
    }
    return statements
  }

  const statements = await generateKnowledgeLevelGuide(skill.name)
  if (statements.length === 5) {
    const { error } = await supabase.from('skills').update({ knowledge_level_guide: statements }).eq('id', skill.id)
    if (error) console.error('Failed to cache knowledge level guide:', error)
  }
  return statements
}
