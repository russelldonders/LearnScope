import { supabase } from './supabaseClient'

const DIAGNOSTIC_VERB_IRI = 'https://learnscope.app/xapi/verbs/assessed'
const DIAGNOSTIC_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/diagnostic'
const SKILL_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/skill'

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
