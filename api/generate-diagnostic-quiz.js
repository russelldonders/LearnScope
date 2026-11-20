import { verifySupabaseUser } from './_lib/auth.js'
import { consumeQuota, sendQuotaExceeded } from './_lib/quota.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'
import { readableLibrarySkillName } from './_lib/skillLibrary.js'
import { createTrackedMessage } from './_lib/trackedAnthropic.js'
import {
  ASSESSMENT_QUESTION_TYPES,
  assessmentQuestionListSchema,
  normalizeAssessmentQuestion,
} from './_lib/courseDraft.js'
import { POOL_CAP, QUIZ_LENGTH, pickQuestions, questionsToGenerate, shuffle } from './_lib/questionPool.js'
import {
  PASS_THRESHOLD,
  cleanAnswer,
  diagnoseLevel,
  loadOwnSkill,
  markAnswer,
  nextRoundLevel,
  questionForLearner,
  resolveCheckTarget,
  quizAssessmentComment,
  recordConfirmedKnowledge,
  recordDiagnosticStatement,
} from './_lib/knowledgeCheck.js'

// The knowledge check, run and marked on the server. Questions for a skill
// at a knowledge level come from a stored pool (skill_questions, 0323); each
// round is kept on a skill_quiz_attempts row (0324) with the questions'
// answers, which the learner never receives until they've answered. Modes
// (one function -- Vercel's function cap is full):
//
//   start   (learner): a round of QUIZ_LENGTH questions on their own skill,
//           without answers, at the level the server decides -- a new run
//           (a few a day per skill) or the next round of one. Unseen ones first; when they've run out and the
//           level holds fewer than POOL_CAP active questions, QUIZ_LENGTH more
//           are generated and stored first. A skill with no readable library
//           entry gets a one-off generated set.
//   check   (learner): marks one answer, once, and reveals that question.
//   finish  (learner): scores the round and records it as evidence.
//   settle  (learner): turns a finished run into the confirmed knowledge
//           level -- the only way one is recorded (see 0324's guards).
//   admin_generate (platform admins): stores `count` more questions for a
//           level, not limited by the cap.
//
// Questions use the course builder's scored-question format (page-builder
// `test_question` blocks) in a mix of types; marking mirrors the course
// player's scoreTestQuestion() (see _lib/knowledgeCheck.js).

const MAX_SKILL_NAME_LENGTH = 200
const MAX_ADMIN_GENERATE = 20
const MAX_EXISTING_TITLES_IN_PROMPT = 60

const KNOWLEDGE_LEVEL_LABELS = {
  1: 'Unfamiliar',
  2: 'Aware',
  3: 'Familiar',
  4: 'Knowledgeable',
  5: 'Deep understanding',
}

// AI-written choices put the right answer first far more often than chance;
// shuffle choice questions before storing so that bias isn't baked into a
// pool every learner draws from. Ordering and matching are left in their
// answer order -- the player mixes them up when showing them.
function prepareQuestion(raw) {
  const question = normalizeAssessmentQuestion(raw, ASSESSMENT_QUESTION_TYPES)
  if (!question) return null
  const correctCount = question.items.filter((item) => item.correct).length
  if (['single', 'true_false'].includes(question.layout) && correctCount !== 1) return null
  const items = ['single', 'multiple'].includes(question.layout) ? shuffle(question.items) : question.items
  return { ...question, items, points: 1 }
}

function buildPrompt({ skillName, level, count, existingTitles }) {
  const levelLabel = KNOWLEDGE_LEVEL_LABELS[level]
  const avoid = existingTitles.length
    ? `\n\nThese questions already exist for this level -- write different ones that test other points, not rewordings:\n${existingTitles
        .slice(0, MAX_EXISTING_TITLES_IN_PROMPT)
        .map((title) => `- ${title}`)
        .join('\n')}`
    : ''
  return `Write ${count} scored test questions that check whether someone's theoretical knowledge of "${skillName}" genuinely reaches the "${levelLabel}" level (level ${level} of 5 on this scale: 1 Unfamiliar, 2 Aware, 3 Familiar, 4 Knowledgeable, 5 Deep understanding).

Pitch every question at level ${level}: someone genuinely at this level should get most right, someone below it should struggle with several. Each question tests one clear point. No trick questions or ambiguous wording.

Use a mix of question layouts, choosing for each point the one that fits it best:
- "single": one right answer among 3-5 options (mark exactly one item correct)
- "multiple": select all that apply, 4-5 options with 2-3 correct
- "true_false": items "True" and "False", exactly one correct
- "short_text": a one- or two-word answer; item labels are every accepted spelling
- "number": a numeric answer in the first item's value, with tolerance for acceptable variation
- "ordering": 3-6 steps listed in the CORRECT order
- "matching": 3-5 items, each label a prompt and detail its correct match
Mostly use single and multiple; use the others only where the content genuinely suits them (e.g. ordering for a real sequence, number only for a real quantity).

For each question: type "test_question", content = the question, secondaryContent = one sentence explaining the right answer, points 1. For fields a question doesn't use, use an empty string, level 2, variant "info", align "left", unit "", tolerance 0, and for items value 0 and correct false. Plain text only.${avoid}

Return exactly ${count} questions.`
}

async function generateQuestions({ userId, skillName, level, count, existingTitles }) {
  const response = await createTrackedMessage({
    feature: 'diagnostic_quiz_generation',
    userId,
    params: {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: Math.min(16000, 700 * count + 500),
      output_config: {
        format: { type: 'json_schema', schema: assessmentQuestionListSchema(ASSESSMENT_QUESTION_TYPES) },
      },
      messages: [{ role: 'user', content: buildPrompt({ skillName, level, count, existingTitles }) }],
    },
  })
  if (response.stop_reason === 'refusal') {
    const error = new Error("Couldn't generate a knowledge check for this skill.")
    error.status = 422
    error.expose = true
    throw error
  }
  const textBlock = response.content.find((b) => b.type === 'text')
  const { questions } = JSON.parse(textBlock.text)
  const seen = new Set(existingTitles.map((title) => title.toLowerCase()))
  return (questions ?? [])
    .map(prepareQuestion)
    .filter((question) => {
      if (!question || seen.has(question.title.toLowerCase())) return false
      seen.add(question.title.toLowerCase())
      return true
    })
    .slice(0, count)
}

async function loadPool(admin, librarySkillId, level) {
  const { data, error } = await admin
    .from('skill_questions')
    .select('id, question, status')
    .eq('library_skill_id', librarySkillId)
    .eq('axis', 'knowledge')
    .eq('level', level)
  if (error) throw error
  return data ?? []
}

async function storeQuestions(admin, { librarySkillId, level, questions, userId, source }) {
  if (questions.length === 0) return []
  const { data, error } = await admin
    .from('skill_questions')
    .insert(
      questions.map((question) => ({
        library_skill_id: librarySkillId,
        axis: 'knowledge',
        level,
        question_type: question.layout,
        question,
        source,
        created_by: userId,
      }))
    )
    .select('id, question, status')
  if (error) throw error
  return data ?? []
}

// The id a learner's answers refer to is the stored question's own id.
function asServed(row) {
  return { ...row.question, id: row.id }
}

// Only this function's own errors reach the learner as-is; provider and
// database errors get a plain message, never their raw details.
function sendError(res, err, fallback) {
  if (err?.expose) {
    res.status(err.status).json({ error: err.message })
    return
  }
  console.error('generate-diagnostic-quiz error:', err)
  if (err?.status === 529 || err?.status === 429 || err?.error?.type === 'overloaded_error') {
    res.status(503).json({ error: 'The AI service is busy right now. Try again in a minute.' })
    return
  }
  res.status(500).json({ error: fallback })
}

// The QUIZ_LENGTH questions for one round, as full stored questions (with
// answers): from the library skill's pool, topping it up first when this
// learner has run out of unseen ones; or a one-off generated set for a skill
// with no readable library entry.
async function selectQuestions(admin, { user, accessToken, skill, level }) {
  let librarySkillId = skill.library_skill_id
  let skillName = String(skill.name ?? '').slice(0, MAX_SKILL_NAME_LENGTH).trim()

  // Pools are keyed by library skill and generated from that entry's own
  // name; a library entry the learner can't see just means no pool.
  if (librarySkillId) {
    const libraryName = await readableLibrarySkillName(accessToken, librarySkillId)
    if (libraryName) skillName = libraryName.trim()
    else librarySkillId = null
  }

  if (!librarySkillId) {
    if (!(await consumeQuota(user.id, 'ai'))) return { quotaExceeded: true }
    const generated = await generateQuestions({ userId: user.id, skillName, level, count: QUIZ_LENGTH, existingTitles: [] })
    return { librarySkillId: null, questions: generated }
  }

  const pool = await loadPool(admin, librarySkillId, level)
  let active = pool.filter((row) => row.status === 'active')

  const { data: servings, error: servingsError } = await admin
    .from('skill_question_servings')
    .select('question_id')
    .eq('user_id', user.id)
    .in('question_id', active.length ? active.map((row) => row.id) : ['00000000-0000-0000-0000-000000000000'])
  if (servingsError) throw servingsError
  const servedIds = new Set((servings ?? []).map((row) => row.question_id))
  let fresh = []

  const room = questionsToGenerate({
    activeCount: active.length,
    unseenCount: active.filter((row) => !servedIds.has(row.id)).length,
  })
  if (room > 0) {
    if (!(await consumeQuota(user.id, 'ai'))) {
      if (active.length === 0) return { quotaExceeded: true }
    } else {
      try {
        const generated = await generateQuestions({
          userId: user.id,
          skillName,
          level,
          count: room,
          existingTitles: pool.map((row) => row.question?.title).filter(Boolean),
        })
        // Re-count just before storing so learners generating at the same
        // moment don't push the level far past the cap.
        const { count: activeNow } = await admin
          .from('skill_questions')
          .select('id', { count: 'exact', head: true })
          .eq('library_skill_id', librarySkillId)
          .eq('axis', 'knowledge')
          .eq('level', level)
          .eq('status', 'active')
        const keep = generated.slice(0, Math.max(0, POOL_CAP - (activeNow ?? active.length)))
        fresh = await storeQuestions(admin, { librarySkillId, level, questions: keep, userId: user.id, source: 'ai' })
        active = [...active, ...fresh]
      } catch (err) {
        // Better a quiz from what's already there than none at all.
        if (active.length === 0) throw err
        console.error('generate-diagnostic-quiz top-up failed, serving existing pool:', err)
      }
    }
  }

  const picked = pickQuestions({ active, servedIds, freshIds: new Set(fresh.map((row) => row.id)) })
  if (picked.length) {
    const now = new Date().toISOString()
    const { error: recordError } = await admin.from('skill_question_servings').upsert(
      picked.map((row) => ({ user_id: user.id, question_id: row.id, last_served_at: now })),
      { onConflict: 'user_id,question_id' }
    )
    if (recordError) console.error('generate-diagnostic-quiz servings record failed:', recordError)
  }
  return { librarySkillId, questions: picked.map(asServed) }
}

// Starts a round. Without a runId it starts a new run of the check, at the
// level the server decides from the learner's record (see
// resolveCheckTarget) -- a few runs per skill a day. With a runId it starts
// that run's next round, at the level the run's earlier rounds lead to.
// Either way the questions (with answers) stay on the attempt and the
// learner is sent them without answers.
async function start(req, res, { user, accessToken }) {
  const { skillId, runId } = req.body ?? {}
  const admin = supabaseAdmin()
  try {
    const skill = await loadOwnSkill(admin, user.id, skillId)
    if (!skill) {
      res.status(404).json({ error: 'Skill not found.' })
      return
    }

    let run
    if (runId) {
      const { data: rounds, error } = await admin
        .from('skill_quiz_attempts')
        .select('level, passed, status, calibrate, round, settled')
        .eq('run_id', runId)
        .eq('user_id', user.id)
        .eq('skill_id', skill.id)
        .order('round', { ascending: true })
      if (error) throw error
      if (!rounds?.length) {
        res.status(404).json({ error: 'Knowledge check not found.' })
        return
      }
      if (rounds.some((r) => r.status !== 'completed') || rounds.some((r) => r.settled)) {
        res.status(409).json({ error: 'This knowledge check can’t continue.' })
        return
      }
      const calibrate = rounds[0].calibrate
      const level = nextRoundLevel({ calibrate, rounds: rounds.map((r) => ({ level: r.level, passed: r.passed })) })
      if (!level) {
        res.status(409).json({ error: 'This knowledge check is already complete.' })
        return
      }
      run = { runId, calibrate, level, round: rounds.length + 1 }
    } else {
      const target = await resolveCheckTarget(admin, skill)
      run = { runId: crypto.randomUUID(), calibrate: target.calibrate, level: target.level, round: 1 }
    }

    // Reserve the round before any AI work: the database enforces the daily
    // limit and one-round-at-a-time under a lock (0324), so parallel starts
    // can't slip past either.
    const { data: attempt, error } = await admin
      .from('skill_quiz_attempts')
      .insert({
        user_id: user.id,
        skill_id: skill.id,
        library_skill_id: skill.library_skill_id,
        run_id: run.runId,
        calibrate: run.calibrate,
        round: run.round,
        level: run.level,
        questions: [],
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '54000') {
        res.status(429).json({ error: 'You’ve taken this knowledge check a few times today. Try again tomorrow.' })
        return
      }
      if (error.code === '23505') {
        res.status(409).json({ error: 'This round has already started.' })
        return
      }
      throw error
    }

    let selection
    try {
      selection = await selectQuestions(admin, { user, accessToken, skill, level: run.level })
    } catch (err) {
      await admin.from('skill_quiz_attempts').delete().eq('id', attempt.id)
      throw err
    }
    if (selection.quotaExceeded || !selection.questions.length) {
      await admin.from('skill_quiz_attempts').delete().eq('id', attempt.id)
      if (selection.quotaExceeded) sendQuotaExceeded(res)
      else res.status(422).json({ error: "Couldn't generate a knowledge check for this skill." })
      return
    }
    const { error: fillError } = await admin
      .from('skill_quiz_attempts')
      .update({ questions: selection.questions, library_skill_id: selection.librarySkillId })
      .eq('id', attempt.id)
    if (fillError) throw fillError
    res.status(200).json({
      runId: run.runId,
      attemptId: attempt.id,
      level: run.level,
      calibrate: run.calibrate,
      questions: selection.questions.map((q) => questionForLearner(q)),
    })
  } catch (err) {
    sendError(res, err, 'Failed to generate knowledge check.')
  }
}

async function loadOwnAttempt(admin, userId, attemptId) {
  if (typeof attemptId !== 'string' || !attemptId) return null
  const { data, error } = await admin
    .from('skill_quiz_attempts')
    .select('*')
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

// Marks one answer, once. The answer and its marking are recorded atomically
// (record_skill_quiz_answer); only then is the whole question -- right
// answers and explanation -- revealed. Asking again returns the recorded
// marking; nothing is revealed for a question left unanswered.
async function check(req, res, { user }) {
  const { attemptId, questionId, answer } = req.body ?? {}
  const admin = supabaseAdmin()
  try {
    const attempt = await loadOwnAttempt(admin, user.id, attemptId)
    if (!attempt) {
      res.status(404).json({ error: 'Knowledge check not found.' })
      return
    }
    const question = attempt.questions.find((q) => q.id === questionId)
    if (!question) {
      res.status(404).json({ error: 'Question not found.' })
      return
    }
    if (attempt.results[question.id]) {
      res.status(200).json({ correct: Boolean(attempt.results[question.id].correct), question })
      return
    }
    if (attempt.status !== 'in_progress') {
      res.status(409).json({ error: 'This round has already finished.' })
      return
    }
    const cleaned = cleanAnswer(question, answer)
    if (cleaned === null) {
      res.status(400).json({ error: 'Answer the question first.' })
      return
    }
    const correct = markAnswer(question, cleaned)
    const { data: recorded, error } = await admin.rpc('record_skill_quiz_answer', {
      p_attempt_id: attempt.id,
      p_question_id: question.id,
      p_answer: cleaned,
      p_correct: correct,
    })
    if (error) throw error
    if (!recorded) {
      // Another request got there first, or the round just finished.
      const latest = await loadOwnAttempt(admin, user.id, attempt.id)
      const stored = latest?.results?.[question.id]
      if (!stored) {
        res.status(409).json({ error: 'This round has already finished.' })
        return
      }
      res.status(200).json({ correct: Boolean(stored.correct), question })
      return
    }
    res.status(200).json({ correct, question })
  } catch (err) {
    sendError(res, err, 'Failed to check your answer.')
  }
}

// Ends a round: closes it first (so no more answers land), scores what was
// recorded -- unanswered questions count as wrong -- and records the round
// as evidence on the learner's skill. Finishing again returns the result.
async function scoreClosedAttempt(admin, attempt) {
  const total = attempt.questions.length
  const score = attempt.questions.filter((q) => attempt.results[q.id]?.correct).length
  const passed = total > 0 && score / total >= PASS_THRESHOLD
  const { error } = await admin.from('skill_quiz_attempts').update({ score, total, passed }).eq('id', attempt.id)
  if (error) throw error
  return { score, total, passed }
}

async function finish(req, res, { user }) {
  const { attemptId } = req.body ?? {}
  const admin = supabaseAdmin()
  try {
    const attempt = await loadOwnAttempt(admin, user.id, attemptId)
    if (!attempt) {
      res.status(404).json({ error: 'Knowledge check not found.' })
      return
    }
    const { data: closed, error: closeError } = await admin
      .from('skill_quiz_attempts')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', attempt.id)
      .eq('status', 'in_progress')
      .select('*')
    if (closeError) throw closeError
    if (!closed?.length) {
      // Already finished (perhaps by a parallel request). Its answers can't
      // change once closed, so scoring it again is safe if that step failed.
      const latest = await loadOwnAttempt(admin, user.id, attempt.id)
      const scored = latest.passed === null ? await scoreClosedAttempt(admin, latest) : latest
      res.status(200).json({ score: scored.score, total: scored.total, passed: scored.passed })
      return
    }
    const final = closed[0]
    const { score, total, passed } = await scoreClosedAttempt(admin, final)

    const skill = await loadOwnSkill(admin, user.id, final.skill_id)
    if (skill) {
      try {
        const statementId = await recordDiagnosticStatement(admin, {
          user,
          skill,
          activityId: `https://learnscope.app/activities/diagnostic/${final.library_skill_id ?? skill.id}/knowledge/${final.level}`,
          name: `Confirming baseline: ${skill.name} (Knowledge level ${final.level})`,
          score: { raw: score, min: 0, max: total, scaled: total ? score / total : 0 },
          extension: {
            diagnosticType: 'quiz',
            axis: 'knowledge',
            attemptId: final.id,
            runId: final.run_id,
            calibratedLevel: final.level,
            confirmedLevel: passed ? final.level : Math.max(1, final.level - 1),
            markedBy: 'server',
            answers: final.questions.map((q) => ({
              questionId: q.id,
              questionType: q.layout,
              question: q.title,
              answer: final.answers[q.id] ?? null,
              correct: Boolean(final.results[q.id]?.correct),
            })),
          },
        })
        await admin.from('skill_quiz_attempts').update({ statement_id: statementId }).eq('id', final.id)
      } catch (err) {
        // The round's result stands; only its evidence entry is missing.
        console.error('generate-diagnostic-quiz evidence record failed:', err)
      }
    }
    res.status(200).json({ score, total, passed })
  } catch (err) {
    sendError(res, err, 'Failed to finish the knowledge check.')
  }
}

// Turns a finished run into the confirmed knowledge level -- the whole run,
// in order, never a chosen subset of rounds. Settling again returns the
// level already recorded.
async function settle(req, res, { user }) {
  const { runId } = req.body ?? {}
  if (typeof runId !== 'string' || !runId) {
    res.status(400).json({ error: 'Missing knowledge check.' })
    return
  }
  const admin = supabaseAdmin()
  try {
    const { data: attempts, error } = await admin
      .from('skill_quiz_attempts')
      .select('*')
      .eq('run_id', runId)
      .eq('user_id', user.id)
      .order('round', { ascending: true })
    if (error) throw error
    if (!attempts?.length) {
      res.status(404).json({ error: 'Knowledge check not found.' })
      return
    }
    if (attempts.some((a) => a.status !== 'completed' || a.passed === null)) {
      res.status(409).json({ error: 'Finish every round first.' })
      return
    }
    if (attempts.every((a) => a.settled && a.assessment_id)) {
      const { data: existing } = await admin.from('skill_assessments').select('level').eq('id', attempts[0].assessment_id).maybeSingle()
      res.status(200).json({ level: existing?.level ?? null })
      return
    }
    if (attempts.some((a) => a.settled)) {
      res.status(409).json({ error: 'This knowledge check is already being recorded.' })
      return
    }
    const calibrate = attempts[0].calibrate
    const rounds = attempts.map((a) => ({ level: a.level, passed: a.passed, score: a.score, total: a.total }))
    const level = diagnoseLevel({ calibrate, rounds })
    if (!level) {
      res.status(400).json({ error: 'This knowledge check isn’t complete yet.' })
      return
    }
    const skill = await loadOwnSkill(admin, user.id, attempts[0].skill_id)
    if (!skill) {
      res.status(404).json({ error: 'Skill not found.' })
      return
    }
    // Claim the run so a double-submit can't record two levels.
    const ids = attempts.map((a) => a.id)
    const { data: claimed, error: claimError } = await admin
      .from('skill_quiz_attempts')
      .update({ settled: true })
      .in('id', ids)
      .eq('settled', false)
      .select('id')
    if (claimError) throw claimError
    const release = (claimedIds) =>
      claimedIds.length ? admin.from('skill_quiz_attempts').update({ settled: false }).in('id', claimedIds) : null
    if ((claimed ?? []).length !== ids.length) {
      await release((claimed ?? []).map((row) => row.id))
      res.status(409).json({ error: 'This knowledge check is already being recorded.' })
      return
    }
    try {
      const assessmentId = await recordConfirmedKnowledge(admin, {
        user,
        skill,
        level,
        comments: quizAssessmentComment({ calibrate, rounds, level }),
      })
      await admin.from('skill_quiz_attempts').update({ assessment_id: assessmentId }).in('id', ids)
    } catch (err) {
      await release(ids)
      throw err
    }
    res.status(200).json({ level })
  } catch (err) {
    sendError(res, err, 'Failed to save your knowledge level.')
  }
}

async function adminGenerate(req, res, { user }) {
  const { librarySkillId, level } = req.body ?? {}
  const count = Number(req.body?.count)
  if (typeof librarySkillId !== 'string' || !librarySkillId) {
    res.status(400).json({ error: 'Missing librarySkillId' })
    return
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_ADMIN_GENERATE) {
    res.status(400).json({ error: `Choose between 1 and ${MAX_ADMIN_GENERATE} questions.` })
    return
  }

  const admin = supabaseAdmin()
  const { data: isPlatformAdmin, error: roleError } = await admin.rpc('is_platform_admin', { check_user_id: user.id })
  if (roleError) {
    sendError(res, roleError, 'Could not verify platform administrator access.')
    return
  }
  if (!isPlatformAdmin) {
    res.status(403).json({ error: 'Platform administrator access required.' })
    return
  }

  try {
    const { data: librarySkill, error: libraryError } = await admin
      .from('skill_library')
      .select('name')
      .eq('id', librarySkillId)
      .maybeSingle()
    if (libraryError) throw libraryError
    if (!librarySkill) {
      res.status(404).json({ error: 'Skill not found.' })
      return
    }
    if (!(await consumeQuota(user.id, 'ai'))) {
      sendQuotaExceeded(res)
      return
    }
    const pool = await loadPool(admin, librarySkillId, level)
    const generated = await generateQuestions({
      userId: user.id,
      skillName: librarySkill.name.trim(),
      level,
      count,
      existingTitles: pool.map((row) => row.question?.title).filter(Boolean),
    })
    const stored = await storeQuestions(admin, { librarySkillId, level, questions: generated, userId: user.id, source: 'ai' })
    res.status(200).json({ added: stored.length })
  } catch (err) {
    sendError(res, err, 'Failed to generate questions.')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return
  }

  const accessToken = authHeader.slice(7)
  const user = await verifySupabaseUser(accessToken)
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  switch (req.body?.mode ?? 'start') {
    case 'start':
      await start(req, res, { user, accessToken })
      return
    case 'check':
      await check(req, res, { user })
      return
    case 'finish':
      await finish(req, res, { user })
      return
    case 'settle':
      await settle(req, res, { user })
      return
    case 'admin_generate': {
      const { level } = req.body ?? {}
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        res.status(400).json({ error: 'Missing or invalid level' })
        return
      }
      await adminGenerate(req, res, { user })
      return
    }
    default:
      res.status(400).json({ error: 'Unknown knowledge check action' })
  }
}
