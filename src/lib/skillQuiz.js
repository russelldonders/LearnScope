import { supabase } from './supabaseClient'

export async function generateQuiz(skillName) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/generate-quiz', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ skillName }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to generate quiz questions.')
  }
  const data = await res.json()
  return data.questions ?? []
}

export async function saveQuizResult(userId, skillId, questions, score, total) {
  const { error } = await supabase.from('skill_baseline_quizzes').insert({
    user_id: userId,
    skill_id: skillId,
    questions,
    score,
    total,
  })
  if (error) throw error
}
