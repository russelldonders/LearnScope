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
// whether a fresh call is actually needed -- reuses skills.knowledge_level_guide
// if it's already there (from skill creation or a previous self-assessment),
// otherwise generates it once and saves it back for next time.
export async function ensureKnowledgeLevelGuide(skill) {
  if (skill.knowledge_level_guide?.length === 5) return skill.knowledge_level_guide

  const statements = await generateKnowledgeLevelGuide(skill.name)
  if (statements.length === 5) {
    const { error } = await supabase.from('skills').update({ knowledge_level_guide: statements }).eq('id', skill.id)
    if (error) console.error('Failed to cache knowledge level guide:', error)
  }
  return statements
}
