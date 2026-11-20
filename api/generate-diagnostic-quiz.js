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

// Knowledge-check questions for one skill at one knowledge level, drawn from
// a stored pool (skill_questions, migration 0323) rather than generated each
// time. Two modes, one function (Vercel's function cap is full):
//
//   serve (default, any signed-in learner): returns QUIZ_LENGTH questions
//     for a library skill + level -- ones this learner hasn't been served
//     before. When they've run out and the level holds fewer than POOL_CAP
//     active questions, QUIZ_LENGTH more are generated and stored first; at
//     the cap, a random selection (unseen first). A skill with no readable
//     library entry has no pool, so it gets a one-off generated set.
//   admin_generate (platform admins, from the skill library): generates and
//     stores `count` more questions for a level -- not limited by the cap.
//
// Questions use the course builder's scored-question format (page-builder
// `test_question` blocks) in a mix of types, so they're marked by the same
// scoreTestQuestion() and edited with the same editor.

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

async function serve(req, res, { user, accessToken }) {
  let { skillName, librarySkillId } = req.body ?? {}
  const { level } = req.body ?? {}
  if (!skillName || typeof skillName !== 'string') {
    res.status(400).json({ error: 'Missing skillName' })
    return
  }
  skillName = skillName.slice(0, MAX_SKILL_NAME_LENGTH).trim()

  // Pools are keyed by library skill and generated from that entry's own
  // name; a library id the caller can't see just means no pool.
  if (librarySkillId) {
    try {
      const libraryName = await readableLibrarySkillName(accessToken, librarySkillId)
      if (libraryName) skillName = libraryName.trim()
      else librarySkillId = null
    } catch (err) {
      sendError(res, err, 'Failed to generate knowledge check.')
      return
    }
  }

  if (!librarySkillId) {
    if (!(await consumeQuota(user.id, 'ai'))) {
      sendQuotaExceeded(res)
      return
    }
    try {
      const questions = await generateQuestions({ userId: user.id, skillName, level, count: QUIZ_LENGTH, existingTitles: [] })
      res.status(200).json({ questions: questions.map((question) => ({ ...question })), pooled: false })
    } catch (err) {
      sendError(res, err, 'Failed to generate knowledge check.')
    }
    return
  }

  const admin = supabaseAdmin()
  try {
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
        if (active.length === 0) {
          sendQuotaExceeded(res)
          return
        }
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

    if (active.length === 0) {
      res.status(422).json({ error: "Couldn't generate a knowledge check for this skill." })
      return
    }

    const picked = pickQuestions({ active, servedIds, freshIds: new Set(fresh.map((row) => row.id)) })

    const now = new Date().toISOString()
    const { error: recordError } = await admin.from('skill_question_servings').upsert(
      picked.map((row) => ({ user_id: user.id, question_id: row.id, last_served_at: now })),
      { onConflict: 'user_id,question_id' }
    )
    if (recordError) console.error('generate-diagnostic-quiz servings record failed:', recordError)

    res.status(200).json({ questions: picked.map(asServed), pooled: true, poolSize: active.length })
  } catch (err) {
    sendError(res, err, 'Failed to generate knowledge check.')
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

  const { level } = req.body ?? {}
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    res.status(400).json({ error: 'Missing or invalid level' })
    return
  }

  if (req.body?.mode === 'admin_generate') {
    await adminGenerate(req, res, { user })
    return
  }
  await serve(req, res, { user, accessToken })
}
