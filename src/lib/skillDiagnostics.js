import { supabase } from './supabaseClient'
import { DIAGNOSTIC_EXTENSION_IRI, SKILL_EXTENSION_IRI } from './xapiStatement'
import { insertStatementSkillLinks } from './activitySkillLinks'

const DIAGNOSTIC_VERB_IRI = 'https://learnscope.app/xapi/verbs/assessed'

// Ten knowledge-check questions for this skill at this level, picked (and
// when needed generated and stored) by the server from the skill's question
// pool -- see api/generate-diagnostic-quiz.js and migration 0323. Each is a
// course-builder scored question (page-builder `test_question` block) whose
// id is the stored question's id.
export async function fetchKnowledgeCheckQuestions({ skill, level }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/generate-diagnostic-quiz', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ skillName: skill.name, level, librarySkillId: skill.library_skill_id ?? null }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to generate knowledge check.')
  }
  return res.json()
}

// One xAPI statement per completed round, recording exactly which pool
// questions were asked and how each was answered and marked -- so a
// confirmed level stays traceable to the questions behind it even after a
// question is later edited or deactivated.
export async function saveDiagnosticAttempt({
  user,
  actor,
  skill,
  questions,
  answers,
  results,
  calibratedLevel,
  confirmedLevel,
}) {
  const total = questions.length
  const score = questions.filter((q) => results[q.id]?.correct).length
  const scoredAnswers = questions.map((q) => ({
    questionId: q.id,
    questionType: q.layout,
    question: q.title,
    answer: answers[q.id] ?? null,
    correct: Boolean(results[q.id]?.correct),
  }))

  const statement = {
    id: crypto.randomUUID(),
    actor: { objectType: 'Agent', name: actor.name, mbox: `mailto:${actor.email}` },
    verb: { id: DIAGNOSTIC_VERB_IRI, display: { 'en-US': 'Assessed' } },
    object: {
      id: `https://learnscope.app/activities/diagnostic/${skill.library_skill_id ?? skill.id}/knowledge/${calibratedLevel}`,
      objectType: 'Activity',
      definition: {
        type: 'http://adlnet.gov/expapi/activities/assessment',
        name: { 'en-US': `Confirming baseline: ${skill.name} (Knowledge level ${calibratedLevel})` },
      },
    },
    result: {
      score: { raw: score, min: 0, max: total, scaled: total ? score / total : 0 },
      extensions: {
        [DIAGNOSTIC_EXTENSION_IRI]: {
          diagnosticType: 'quiz',
          axis: 'knowledge',
          calibratedLevel,
          confirmedLevel,
          answers: scoredAnswers,
        },
      },
    },
    context: {
      extensions: {
        [SKILL_EXTENSION_IRI]: [{ id: skill.id, name: skill.name }],
      },
    },
    timestamp: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('xapi_statements')
    .insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
      skill_id: skill.id,
    })
    .select('id')
    .single()
  if (error) throw error
  await insertStatementSkillLinks(user.id, data.id, [skill.id])

  return { score, total }
}

// Server decides cache-hit vs. generate, same reasoning as the quiz above.
// calibrate=true (no level) produces a plan spanning the full 1-5 range
// instead of one pitched at a single level -- see api/interview.js.
export async function fetchOrGenerateInterviewPlan({ skill, level, calibrate = false }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/interview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      type: 'plan',
      skillName: skill.name,
      level,
      calibrate,
      librarySkillId: skill.library_skill_id ?? null,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to prepare interview.')
  }
  return res.json()
}

// One stateless turn: server holds no session state, the client resends the
// growing transcript each time (same shape the Anthropic Messages API takes
// natively -- alternating user/assistant turns starting with the learner's
// first answer, since the plan's opening question is shown to the learner
// directly from cached content rather than round-tripping through the model).
export async function sendInterviewTurn({ skillName, level, calibrate = false, plan, transcript }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/interview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ type: 'turn', skillName, level, calibrate, plan, transcript }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to continue the interview.')
  }
  return res.json()
}

// Same evidence shape as saveDiagnosticAttempt (diagnosticType 'interview'
// instead of 'quiz') -- the full Q&A transcript is stored as the record's
// evidence rather than just the final level, so the confirmed level stays
// auditable back to what was actually said, not just an AI's bare verdict.
export async function saveInterviewAttempt({
  user,
  actor,
  skill,
  diagnosticContentId,
  calibratedLevel,
  confirmedLevel,
  transcript,
  reasoning,
}) {
  const statement = {
    id: crypto.randomUUID(),
    actor: { objectType: 'Agent', name: actor.name, mbox: `mailto:${actor.email}` },
    verb: { id: DIAGNOSTIC_VERB_IRI, display: { 'en-US': 'Assessed' } },
    object: {
      id: `https://learnscope.app/activities/diagnostic/${diagnosticContentId ?? crypto.randomUUID()}`,
      objectType: 'Activity',
      definition: {
        type: 'http://adlnet.gov/expapi/activities/assessment',
        name: { 'en-US': `Confirming baseline (interview): ${skill.name} (Knowledge level ${calibratedLevel})` },
        // No interactionType: xAPI's vocabulary (choice/true-false/fill-in/
        // matching/performance/sequencing/likert/numeric/other/long-fill-in)
        // has nothing for a free-form conversation, and 'interview' isn't a
        // real value -- diagnosticType below already records what kind of
        // check this was, so the field is just omitted rather than guessed.
      },
    },
    result: {
      extensions: {
        [DIAGNOSTIC_EXTENSION_IRI]: {
          diagnosticContentId,
          diagnosticType: 'interview',
          axis: 'knowledge',
          calibratedLevel,
          confirmedLevel,
          transcript,
          reasoning,
        },
      },
    },
    context: {
      extensions: {
        [SKILL_EXTENSION_IRI]: [{ id: skill.id, name: skill.name }],
      },
    },
    timestamp: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('xapi_statements')
    .insert({
      user_id: user.id,
      statement,
      recorded_at: statement.timestamp,
      skill_id: skill.id,
    })
    .select('id')
    .single()
  if (error) throw error
  await insertStatementSkillLinks(user.id, data.id, [skill.id])
}
