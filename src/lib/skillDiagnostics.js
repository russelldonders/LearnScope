import { supabase } from './supabaseClient'
import { DIAGNOSTIC_EXTENSION_IRI, SKILL_EXTENSION_IRI } from './xapiStatement'

const DIAGNOSTIC_VERB_IRI = 'https://learnscope.app/xapi/verbs/assessed'

// Server decides cache-hit vs. generate -- the client never writes to
// skill_diagnostic_content directly (see api/generate-diagnostic-quiz.js).
export async function fetchOrGenerateDiagnosticQuiz({ skill, level }) {
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

// One xAPI statement per completed attempt, using the shared content row's
// id as the Activity id so every learner's attempt against the same cached
// quiz refers to the same Activity, per xAPI's own Activity concept. This
// is a distinct statement shape from xapiStatement.js's buildStatement(),
// which is purpose-built for the freeform Record Activity flow.
export async function saveDiagnosticAttempt({
  user,
  actor,
  skill,
  diagnosticContentId,
  content,
  answers,
  calibratedLevel,
  confirmedLevel,
}) {
  const total = content.questions.length
  const scoredAnswers = content.questions.map((q, i) => ({
    questionId: q.id,
    chosenChoiceId: answers[i] ?? null,
    correct: q.correctResponsesPattern[0] === answers[i],
  }))
  const score = scoredAnswers.filter((a) => a.correct).length

  const statement = {
    id: crypto.randomUUID(),
    actor: { objectType: 'Agent', name: actor.name, mbox: `mailto:${actor.email}` },
    verb: { id: DIAGNOSTIC_VERB_IRI, display: { 'en-US': 'Assessed' } },
    object: {
      id: `https://learnscope.app/activities/diagnostic/${diagnosticContentId ?? crypto.randomUUID()}`,
      objectType: 'Activity',
      definition: {
        type: 'http://adlnet.gov/expapi/activities/assessment',
        name: { 'en-US': `Confirming baseline: ${skill.name} (Knowledge level ${calibratedLevel})` },
        interactionType: 'choice',
      },
    },
    result: {
      score: { raw: score, min: 0, max: total, scaled: total ? score / total : 0 },
      extensions: {
        [DIAGNOSTIC_EXTENSION_IRI]: {
          diagnosticContentId,
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
        [SKILL_EXTENSION_IRI]: { id: skill.id, name: skill.name },
      },
    },
    timestamp: new Date().toISOString(),
  }

  const { error } = await supabase.from('xapi_statements').insert({
    user_id: user.id,
    statement,
    recorded_at: statement.timestamp,
    skill_id: skill.id,
  })
  if (error) throw error

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
        [SKILL_EXTENSION_IRI]: { id: skill.id, name: skill.name },
      },
    },
    timestamp: new Date().toISOString(),
  }

  const { error } = await supabase.from('xapi_statements').insert({
    user_id: user.id,
    statement,
    recorded_at: statement.timestamp,
    skill_id: skill.id,
  })
  if (error) throw error
}
