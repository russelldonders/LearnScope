import { supabase } from './supabaseClient'
import { LEVEL_LABELS } from './levels'

export async function validateSkillAgainstTarget({
  skill,
  targetLevel,
  selfLevel,
  selfComments,
  experiences,
  quizzes,
  peerRatings,
  courses,
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
      skillName: skill.name,
      targetLevel: LEVEL_LABELS[targetLevel],
      selfLevel: selfLevel ? LEVEL_LABELS[selfLevel] : null,
      selfComments: selfComments || null,
      experiences,
      quizzes,
      peerRatings,
      courses,
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
export async function saveValidationResult(user, skill, result, goToDeveloping) {
  const { error: assessError } = await supabase.from('skill_assessments').insert({
    skill_id: skill.id,
    user_id: user.id,
    level: result.level,
    comments: result.feedback,
    source: 'ai_evaluation',
  })
  if (assessError) throw assessError

  const skillUpdate = { level: result.level }
  if (result.passed) {
    skillUpdate.lifecycle_stage = 'validated'
  } else if (goToDeveloping) {
    skillUpdate.lifecycle_stage = 'developing'
  }
  const { error: skillError } = await supabase.from('skills').update(skillUpdate).eq('id', skill.id)
  if (skillError) throw skillError
}
