import { shuffle } from './questionPool.js'

// Server-side marking and recording for knowledge checks and interviews
// (migration 0324). Learners get questions without their answers, send each
// answer here to be marked, and only the server records the outcome as a
// confirmed knowledge level.

export const PASS_THRESHOLD = 0.7

const DIAGNOSTIC_VERB_IRI = 'https://learnscope.app/xapi/verbs/assessed'
const DIAGNOSTIC_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/diagnostic'
const SKILL_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/skill'

export const KNOWLEDGE_LEVEL_LABELS = {
  1: 'Unfamiliar',
  2: 'Aware',
  3: 'Familiar',
  4: 'Knowledgeable',
  5: 'Deep understanding',
}

const CHOICE_LAYOUTS = ['single', 'multiple', 'true_false']
const MAX_TEXT_ANSWER = 300

function sameValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

// Mirrors scoreTestQuestion() in src/lib/pageBuilder.js (the course player's
// marking) for a stored, already-normalised question -- kept in step by
// knowledgeCheck.test.js, which runs both on the same cases.
export function markAnswer(question, answer) {
  const items = question.items ?? []
  if (CHOICE_LAYOUTS.includes(question.layout)) {
    const correctIds = items.filter((item) => item.correct).map((item) => item.id).sort()
    const chosen = (Array.isArray(answer) ? answer : [answer]).filter(Boolean).map(String).sort()
    return sameValues(chosen, correctIds)
  }
  if (question.layout === 'short_text') {
    const accepted = items.map((item) => String(item.label ?? '').trim().toLocaleLowerCase()).filter(Boolean)
    return accepted.includes(String(answer ?? '').trim().toLocaleLowerCase())
  }
  if (question.layout === 'number') {
    const expected = Number(items[0]?.value)
    const actual = Number(answer)
    return Number.isFinite(actual) && Math.abs(actual - expected) <= (Number(question.tolerance) || 0)
  }
  if (question.layout === 'ordering') {
    return sameValues(Array.isArray(answer) ? answer.map(String) : [], items.map((item) => item.id))
  }
  if (question.layout === 'matching') {
    return items.every((item) => String(answer?.[item.id] ?? '') === item.detail)
  }
  return false
}

// The answer in the shape this question takes, or null if it isn't one.
export function cleanAnswer(question, answer) {
  const ids = (question.items ?? []).map((item) => item.id)
  switch (question.layout) {
    case 'single':
    case 'true_false':
      return typeof answer === 'string' && ids.includes(answer) ? answer : null
    case 'multiple':
      return Array.isArray(answer) && answer.length > 0 && answer.every((id) => ids.includes(id)) ? [...new Set(answer)] : null
    case 'short_text':
      return typeof answer === 'string' && answer.trim() ? answer.slice(0, MAX_TEXT_ANSWER) : null
    case 'number':
      return (typeof answer === 'string' || typeof answer === 'number') && Number.isFinite(Number(answer)) && String(answer).trim() !== ''
        ? String(answer).slice(0, 40)
        : null
    case 'ordering':
      return Array.isArray(answer) && answer.length === ids.length && sameValues([...answer].map(String).sort(), [...ids].sort())
        ? answer.map(String)
        : null
    case 'matching': {
      if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return null
      const cleaned = {}
      for (const id of ids) {
        if (typeof answer[id] !== 'string' || !answer[id]) return null
        cleaned[id] = answer[id].slice(0, 1200)
      }
      return cleaned
    }
    default:
      return null
  }
}

// What a learner sees before answering: no right answers, accepted answers,
// expected numbers, correct order, correct matches or explanation.
export function questionForLearner(question, random = Math.random) {
  const items = question.items ?? []
  const base = { id: question.id, type: 'test_question', title: question.title, layout: question.layout, points: 1 }
  if (question.layout === 'true_false') {
    return { ...base, items: items.map((item) => ({ id: item.id, label: item.label })) }
  }
  if (CHOICE_LAYOUTS.includes(question.layout)) {
    // Reshuffled every time, so no stored order (an admin's or an import's
    // "right answer first") gives anything away.
    return { ...base, items: shuffle(items, random).map((item) => ({ id: item.id, label: item.label })) }
  }
  if (question.layout === 'ordering') {
    let order = shuffle(items, random)
    if (order.length > 1 && sameValues(order.map((i) => i.id), items.map((i) => i.id))) order = [...order.slice(1), order[0]]
    return { ...base, items: order.map((item) => ({ id: item.id, label: item.label })) }
  }
  if (question.layout === 'matching') {
    return {
      ...base,
      items: items.map((item) => ({ id: item.id, label: item.label })),
      options: shuffle([...new Set(items.map((item) => item.detail).filter(Boolean))], random),
    }
  }
  return { ...base, items: [] } // short_text, number: the items are the answer
}

// The level a finished check confirms, from its rounds in the order taken --
// or null if the rounds aren't a valid run of the check. Confirming: one
// round; a pass confirms its level, a fail steps down one. Calibrating: the
// walk from level 3 (pass -> up one, fail -> down one) that the player
// follows, ending where the next level is already known.
export function diagnoseLevel({ calibrate, rounds }) {
  if (!rounds.length) return null
  if (!calibrate) {
    if (rounds.length !== 1) return null
    const [round] = rounds
    return round.passed ? round.level : Math.max(1, round.level - 1)
  }
  let expected = 3
  let lowPass = 0
  let highFail = 6
  for (let i = 0; i < rounds.length; i++) {
    const { level, passed } = rounds[i]
    if (level !== expected) return null
    const last = i === rounds.length - 1
    if (passed) {
      lowPass = level
      if (level + 1 >= highFail) return last ? level : null
      expected = level + 1
    } else {
      highFail = level
      if (level - 1 <= lowPass) return last ? Math.max(1, lowPass) : null
      expected = level - 1
    }
  }
  return null // stopped before the walk reached its answer
}

// The next round's level in a run, from its finished rounds in order, or
// null when the run already has its answer (or isn't a valid run).
export function nextRoundLevel({ calibrate, rounds }) {
  if (!rounds.length) return null
  if (!calibrate) return null // confirming is a single round
  if (diagnoseLevel({ calibrate, rounds }) !== null) return null
  let expected = 3
  let lowPass = 0
  let highFail = 6
  for (const { level, passed } of rounds) {
    if (level !== expected) return null
    if (passed) {
      lowPass = level
      if (level + 1 >= highFail) return null
      expected = level + 1
    } else {
      highFail = level
      if (level - 1 <= lowPass) return null
      expected = level - 1
    }
  }
  return expected
}

// What a new check or interview on this skill targets, decided by the
// server from the learner's own record -- the same rule the skill page uses
// to label it: the latest knowledge-axis assessment's level (a newer self-
// assessment is a claim to confirm), else the confirmed level, else nothing
// to pitch at yet, so find the level from scratch starting at 3.
export async function resolveCheckTarget(admin, skill) {
  const { data, error } = await admin
    .from('skill_assessments')
    .select('level')
    .eq('skill_id', skill.id)
    .eq('axis', 'knowledge')
    .order('assessed_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const level = data?.[0]?.level ?? skill.knowledge_level ?? null
  if (!level) return { calibrate: true, level: 3 }
  return { calibrate: false, level: Math.min(5, Math.max(1, level)) }
}

export function quizAssessmentComment({ calibrate, rounds, level }) {
  if (!calibrate) {
    const round = rounds[0]
    return round.passed
      ? `Confirmed via knowledge check: scored ${round.score}/${round.total} at ${KNOWLEDGE_LEVEL_LABELS[round.level]}, meeting expectations for that level.`
      : `Confirmed via knowledge check: scored ${round.score}/${round.total} at ${KNOWLEDGE_LEVEL_LABELS[round.level]}, below expectations for that level — adjusted to ${KNOWLEDGE_LEVEL_LABELS[level]}.`
  }
  const path = rounds
    .map((r) => `${KNOWLEDGE_LEVEL_LABELS[r.level]} (${r.score}/${r.total}, ${r.passed ? 'passed' : 'below expectations'})`)
    .join(' → ')
  return `Calibrated via knowledge check — no self-assessment existed to pitch at, so this found the level from scratch: ${path}. Diagnosed at ${KNOWLEDGE_LEVEL_LABELS[level]}.`
}

// The learner's own skills row, or null if it isn't theirs.
export async function loadOwnSkill(admin, userId, skillId) {
  if (typeof skillId !== 'string' || !skillId) return null
  const { data, error } = await admin
    .from('skills')
    .select('id, user_id, name, library_skill_id, lifecycle_stage, knowledge_level')
    .eq('id', skillId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function actorFor(admin, user) {
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle()
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(' ') || user.email || 'Learner'
  return { objectType: 'Agent', name, mbox: `mailto:${user.email}` }
}

// One xAPI statement of evidence for a knowledge check round or interview,
// linked to its skill -- written by the server, since learners can no longer
// write diagnostic statements themselves (0324).
export async function recordDiagnosticStatement(admin, { user, skill, activityId, name, score, extension }) {
  const statement = {
    id: crypto.randomUUID(),
    actor: await actorFor(admin, user),
    verb: { id: DIAGNOSTIC_VERB_IRI, display: { 'en-US': 'Assessed' } },
    object: {
      id: activityId,
      objectType: 'Activity',
      definition: { type: 'http://adlnet.gov/expapi/activities/assessment', name: { 'en-US': name } },
    },
    result: {
      ...(score ? { score } : {}),
      extensions: { [DIAGNOSTIC_EXTENSION_IRI]: extension },
    },
    context: { extensions: { [SKILL_EXTENSION_IRI]: [{ id: skill.id, name: skill.name }] } },
    timestamp: new Date().toISOString(),
  }
  const { data, error } = await admin
    .from('xapi_statements')
    .insert({ user_id: user.id, statement, recorded_at: statement.timestamp, skill_id: skill.id })
    .select('id')
    .single()
  if (error) throw error
  const { error: linkError } = await admin
    .from('xapi_statement_skills')
    .insert({ user_id: user.id, statement_id: data.id, skill_id: skill.id })
  if (linkError && linkError.code !== '23505') throw linkError
  return data.id
}

// The confirmed knowledge level itself: the assessment record, and the
// skill's current knowledge level (moving it out of "confirming baseline"
// only if that's where it still is).
export async function recordConfirmedKnowledge(admin, { user, skill, level, comments }) {
  const { data, error } = await admin
    .from('skill_assessments')
    .insert({ skill_id: skill.id, user_id: user.id, level, axis: 'knowledge', source: 'diagnostic_confirmed', comments })
    .select('id')
    .single()
  if (error) throw error
  const skillUpdate = { knowledge_level: level }
  if (skill.lifecycle_stage === 'confirming_baseline') skillUpdate.lifecycle_stage = 'identified'
  const { error: skillError } = await admin.from('skills').update(skillUpdate).eq('id', skill.id).eq('user_id', user.id)
  if (skillError) throw skillError
  return data.id
}
