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
// is the one place that decides whether a fresh call is actually needed --
// reuses skills.practical_level_guide if it's already there, otherwise
// generates it once and saves it back for next time.
export async function ensurePracticalLevelGuide(skill) {
  if (skill.practical_level_guide?.length === 5) return skill.practical_level_guide

  const statements = await generatePracticalLevelGuide(skill.name)
  if (statements.length === 5) {
    const { error } = await supabase.from('skills').update({ practical_level_guide: statements }).eq('id', skill.id)
    if (error) console.error('Failed to cache practical level guide:', error)
  }
  return statements
}
