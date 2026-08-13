import { supabase } from './supabaseClient'
import { LEVEL_LABELS } from './levels'
import { SKILL_LIFECYCLE_LABELS, lifecycleWeight } from './skillLifecycle'
import { computeNextSelfAssessmentDate } from './checkin'

export async function fetchPeerRaterProgress(skillId) {
  const { data, error } = await supabase.rpc('get_peer_rater_progress', { p_skill_id: skillId })
  if (error) throw error
  return data ?? []
}

export function buildWeightedPeerRatings(peerRatings, raterProgressRows) {
  const progressById = Object.fromEntries(raterProgressRows.map((r) => [r.peer_rating_id, r]))
  return peerRatings.map((r) => {
    const stage = progressById[r.id]?.rater_lifecycle_stage ?? null
    return {
      level: LEVEL_LABELS[r.level],
      comments: r.comments || null,
      raterTracksThisSkill: Boolean(stage),
      raterOwnStage: stage ? SKILL_LIFECYCLE_LABELS[stage] : null,
      weight: Math.round(lifecycleWeight(stage) * 100) / 100,
    }
  })
}

export async function assessBaseline({ skill, selfLevel, selfComments, experiences, quizzes, peerRatings }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/assess-baseline', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      skillName: skill.name,
      selfLevel: selfLevel ? LEVEL_LABELS[selfLevel] : null,
      selfComments: selfComments || null,
      experiences,
      quizzes,
      peerRatings,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to assess baseline.')
  }
  return res.json()
}

export async function saveBaselineAssessment(user, skill, level, reasoning) {
  const { error: assessError } = await supabase.from('skill_assessments').insert({
    skill_id: skill.id,
    user_id: user.id,
    level,
    comments: reasoning,
    source: 'ai_baseline',
  })
  if (assessError) throw assessError

  const skillUpdate = { level, lifecycle_stage: 'baseline_assessed' }
  if (skill.checkin_frequency_value && skill.checkin_frequency_unit) {
    skillUpdate.next_checkin_date = computeNextSelfAssessmentDate(
      null,
      skill.checkin_frequency_value,
      skill.checkin_frequency_unit
    )
  }
  const { error: skillError } = await supabase.from('skills').update(skillUpdate).eq('id', skill.id)
  if (skillError) throw skillError
}
