import { supabase } from './supabaseClient'

// Knowledge checks and "Interview me" run on the server (migration 0324):
// questions arrive without their answers, each answer is marked there, the
// interview's conversation is kept there, and only the server records the
// confirmed knowledge level and its evidence. These are the browser's calls.

async function post(path, body, fallback) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || fallback)
  return data
}

// One round of a knowledge check on the learner's own skill. Without a
// runId it starts a new check; with one, that check's next round. The
// server decides the level. { runId, attemptId, level, calibrate, questions }
// -- course-builder scored questions without their answers (matching
// questions carry their choices in `options`).
export function startKnowledgeCheck({ skill, runId = null }) {
  return post('/api/generate-diagnostic-quiz', { mode: 'start', skillId: skill.id, runId }, 'Failed to generate knowledge check.')
}

// { correct, question } -- question is now the full one, answers included.
export function checkKnowledgeAnswer({ attemptId, questionId, answer }) {
  return post('/api/generate-diagnostic-quiz', { mode: 'check', attemptId, questionId, answer }, 'Failed to check your answer.')
}

// { score, total, passed } for the round.
export function finishKnowledgeCheck({ attemptId }) {
  return post('/api/generate-diagnostic-quiz', { mode: 'finish', attemptId }, 'Failed to finish the knowledge check.')
}

// Records the confirmed level from the finished check: { level }.
export function settleKnowledgeCheck({ runId }) {
  return post('/api/generate-diagnostic-quiz', { mode: 'settle', runId }, 'Failed to save your knowledge level.')
}

// { sessionId, openingQuestion, topics, level, calibrate } -- the server
// decides the level from the learner's record.
export function startInterview({ skill }) {
  return post('/api/interview', { type: 'start', skillId: skill.id }, 'Failed to prepare interview.')
}

// { message, done, confirmedLevel?, reasoning? }
export function sendInterviewAnswer({ sessionId, answer }) {
  return post('/api/interview', { type: 'turn', sessionId, answer }, 'Failed to continue the interview.')
}

// Records the finished interview's verdict as the confirmed level: { level }.
export function saveInterview({ sessionId }) {
  return post('/api/interview', { type: 'save', sessionId }, 'Failed to save your knowledge level.')
}
