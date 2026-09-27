import { supabase } from './supabaseClient'
import { LEVEL_LABELS } from './levels'

export async function validateSkillAgainstTarget({
  skill,
  targetLevel,
  selfLevel,
  selfComments,
  activities,
  peerRatings,
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/validate-skill', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      skillId: skill.id,
      skillName: skill.name,
      targetLevel: LEVEL_LABELS[targetLevel],
      selfLevel: selfLevel ? LEVEL_LABELS[selfLevel] : null,
      selfComments: selfComments || null,
      activities,
      peerRatings,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to validate skill.')
  }
  return res.json()
}

// goToDeveloping: only meaningful when the result didn't pass -- lets the
// learner choose to send the skill back a stage rather than that happening
// silently. A pass always advances to "validated" (displays as "Maintaining").
// Saved by the server from the signed grant validateSkillAgainstTarget
// returned, not written here: learners can't set "validated" directly.
export async function saveValidationResult(skill, result, goToDeveloping) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/validate-skill', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'save', grant: result.grant, goToDeveloping: Boolean(goToDeveloping) }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to save the result.')
  }
}
