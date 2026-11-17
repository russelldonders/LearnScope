import { waitUntil } from '@vercel/functions'
import { verifySupabaseUser } from './auth.js'
import { consumeQuota, sendQuotaExceeded } from './quota.js'
import { assessmentQuestionListSchema, buildCourseDraftRequest, checkGeneratedCourseDraft } from './courseDraft.js'
import { supabaseAdmin } from './supabaseAdmin.js'
import { createTrackedMessage } from './trackedAnthropic.js'

// A job still running after the function's own time limit (300s in
// vercel.json) was cut off and will never finish. Past this, it's failed.
const STALLED_AFTER_MS = 6 * 60 * 1000
const STALLED_MESSAGE = 'The course took too long to generate and was stopped. Try again.'

export async function failStalledJobs(admin, { jobId = null, requestedBy = null, now = Date.now() } = {}) {
  let query = admin
    .from('skill_course_generation_jobs')
    .update({
      status: 'failed',
      error_message: STALLED_MESSAGE,
      updated_at: new Date(now).toISOString(),
      completed_at: new Date(now).toISOString(),
    })
    .eq('status', 'running')
    .lt('updated_at', new Date(now - STALLED_AFTER_MS).toISOString())
  if (jobId) query = query.eq('id', jobId)
  if (requestedBy) query = query.eq('requested_by', requestedBy)
  const { error } = await query
  if (error) console.error('skill course generation stalled job update failed:', error)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function platformAdminCaller(req, res) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' })
    return null
  }

  const caller = await verifySupabaseUser(authHeader.slice(7))
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return null
  }

  const { data: isPlatformAdmin, error } = await supabaseAdmin().rpc('is_platform_admin', {
    check_user_id: caller.id,
  })
  if (error) {
    console.error('skill course job access error:', error)
    res.status(500).json({ error: 'Could not verify platform administrator access.' })
    return null
  }
  if (!isPlatformAdmin) {
    res.status(403).json({ error: 'Platform administrator access required.' })
    return null
  }
  return caller
}

// What an administrator sees when a course fails: what actually went wrong,
// in plain words, and whether trying again is likely to help.
export function generationErrorMessage(error) {
  if (error?.userMessage) return error.userMessage
  if (error?.status === 401 || error?.status === 403) return 'Course generation could not authenticate with the AI service.'
  if (error?.status === 429) return 'The AI service is busy or its usage limit has been reached. Try again shortly.'
  if (error?.status === 400) return 'The AI service rejected the course request format.'
  if (error?.status === 422) return 'The AI declined to write this course. Try again, or change the skill’s description.'
  if (error?.status === 529 || error?.error?.type === 'overloaded_error') return 'The AI service is overloaded right now. Try again in a minute.'
  if (error?.status >= 500) return 'The AI service had an error. Try again.'
  if (error instanceof SyntaxError) return 'The AI’s reply couldn’t be read as a course. Try again.'
  return 'Failed to generate the course. Try again.'
}

function unusableCourse(message) {
  return Object.assign(new Error(message), { userMessage: message })
}

const MAX_QUESTION_REPAIR_ATTEMPTS = 3
const MAX_GENERATION_TOKENS = 24000
const QUESTION_REPAIR_TOKENS = 6000

function missingQuestionCount(problem, wanted) {
  const match = /^The AI wrote (\d+) scored questions instead of (\d+)\.$/.exec(problem ?? '')
  if (!match || Number(match[2]) !== wanted || Number(match[1]) >= wanted) return 0
  return wanted - Number(match[1])
}

export function assessmentQuestionRepairPrompt(originalPrompt, missing, assessment, existingQuestions = []) {
  return `${originalPrompt}

<assessment_correction>
The course is already written. Return exactly ${missing} new test_question ${missing === 1 ? 'block' : 'blocks'} only; do not regenerate the course.
Use only these layouts: ${assessment.questionTypes.join(', ')}. Every question is worth ${assessment.pointsPerQuestion} ${assessment.pointsPerQuestion === 1 ? 'point' : 'points'}.
Make every question valid for its layout, unambiguous, and different from these existing questions:
${existingQuestions.length ? existingQuestions.map((question) => `- ${question}`).join('\n') : '- None'}
Check that the questions array contains exactly ${missing} items before returning it.
</assessment_correction>`
}

function finalTestPage(raw) {
  const sections = Array.isArray(raw?.sections) ? raw.sections : []
  const pages = Array.isArray(sections.at(-1)?.pages) ? sections.at(-1).pages : []
  return pages[0] ?? null
}

function mergeAssessmentQuestions(raw, additions, wanted) {
  const merged = structuredClone(raw)
  const page = finalTestPage(merged)
  if (!page || !Array.isArray(page.blocks)) return merged
  const otherBlocks = page.blocks.filter((block) => block?.type !== 'test_question')
  const existingQuestions = page.blocks.filter((block) => block?.type === 'test_question')
  // Put the purpose-built replacements first. If the original response had
  // the right raw count but some malformed questions, they replace those
  // unusable entries instead of pushing the page beyond its block limit.
  page.blocks = [...otherBlocks, ...additions, ...existingQuestions].slice(0, otherBlocks.length + wanted)
  return merged
}

async function createCourseMessage({ request, userId, organisationId, maxTokens = request.maxTokens }) {
  return createTrackedMessage({
    feature: 'skill_level_course_generation',
    userId,
    organisationId,
    params: {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      output_config: { format: { type: 'json_schema', schema: request.schema } },
      messages: [{ role: 'user', content: request.prompt }],
    },
  })
}

async function runGenerationJob({ jobId, request, userId, organisationId }) {
  const admin = supabaseAdmin()
  const { data: claimed, error: claimError } = await admin
    .from('skill_course_generation_jobs')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle()
  if (claimError) throw claimError
  if (!claimed) return

  try {
    let response = await createCourseMessage({ request, userId, organisationId })
    if (response.stop_reason === 'max_tokens' && request.maxTokens < MAX_GENERATION_TOKENS) {
      response = await createCourseMessage({ request, userId, organisationId, maxTokens: MAX_GENERATION_TOKENS })
    }
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('AI refusal'), { status: 422 })
    if (response.stop_reason === 'max_tokens') {
      throw unusableCourse('The course was too long to write in one go. Try again with fewer sections or pages.')
    }
    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock) throw unusableCourse('The AI’s reply had no course in it. Try again.')

    let raw = JSON.parse(textBlock.text)
    if (request.values.assessment) raw = mergeAssessmentQuestions(raw, [], request.values.assessment.questionCount)
    let { draft, problem } = checkGeneratedCourseDraft(raw, request.values)

    for (let attempt = 1; !draft && attempt <= MAX_QUESTION_REPAIR_ATTEMPTS; attempt += 1) {
      const assessment = request.values.assessment
      const missing = assessment ? missingQuestionCount(problem, assessment.questionCount) : 0
      if (!missing) break
      const page = finalTestPage(raw)
      const existingQuestions = (Array.isArray(page?.blocks) ? page.blocks : [])
        .filter((block) => block?.type === 'test_question' && typeof block.content === 'string')
        .map((block) => block.content.trim())
        .filter(Boolean)
      const repairResponse = await createTrackedMessage({
        feature: 'skill_level_course_generation',
        userId,
        organisationId,
        params: {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: Math.min(QUESTION_REPAIR_TOKENS, 1000 + missing * 500),
          output_config: { format: { type: 'json_schema', schema: assessmentQuestionListSchema(assessment.questionTypes) } },
          messages: [{ role: 'user', content: assessmentQuestionRepairPrompt(request.prompt, missing, assessment, existingQuestions) }],
        },
      })
      if (repairResponse.stop_reason === 'refusal') throw Object.assign(new Error('AI refusal'), { status: 422 })
      if (repairResponse.stop_reason === 'max_tokens') continue
      const repairText = repairResponse.content.find((block) => block.type === 'text')
      if (!repairText) continue
      const questions = JSON.parse(repairText.text)?.questions
      if (!Array.isArray(questions) || questions.length === 0) continue
      raw = mergeAssessmentQuestions(raw, questions.slice(0, missing), assessment.questionCount)
      ;({ draft, problem } = checkGeneratedCourseDraft(raw, request.values))
    }
    if (!draft) throw unusableCourse(`${problem} The course wasn’t saved after automatic correction attempts. Try again.`)

    // A cancellation update and this completion update race safely: only a
    // job still marked running may receive and expose the generated draft.
    const { error: completeError } = await admin
      .from('skill_course_generation_jobs')
      .update({
        status: 'completed',
        draft,
        error_message: null,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'running')
    if (completeError) throw completeError
  } catch (error) {
    console.error('skill course generation job error:', error)
    const { error: failError } = await admin
      .from('skill_course_generation_jobs')
      .update({
        status: 'failed',
        error_message: generationErrorMessage(error),
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', 'running')
    if (failError) console.error('skill course generation job status update failed:', failError)
  }
}

async function startJob(req, res, caller) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    res.status(503).json({ error: 'Course generation is not configured on this environment.' })
    return
  }

  const { organisationId, skillId, level, ...brief } = req.body ?? {}
  if (!UUID_PATTERN.test(organisationId ?? '') || !UUID_PATTERN.test(skillId ?? '') || !Number.isInteger(level) || level < 1 || level > 5) {
    res.status(400).json({ error: 'Invalid skill course generation request.' })
    return
  }
  const request = buildCourseDraftRequest(brief)
  if (request.error) {
    res.status(400).json({ error: request.error })
    return
  }

  const admin = supabaseAdmin()
  const [{ data: systemOrganisation, error: organisationError }, { data: skill, error: skillError }] = await Promise.all([
    admin.from('organisations').select('id').eq('id', organisationId).eq('is_system', true).eq('status', 'active').maybeSingle(),
    admin.from('skill_library').select('id').eq('id', skillId).eq('status', 'active').maybeSingle(),
  ])
  if (organisationError || skillError) {
    console.error('skill course job validation error:', organisationError ?? skillError)
    res.status(500).json({ error: 'Could not validate the course generation request.' })
    return
  }
  if (!systemOrganisation || !skill) {
    res.status(400).json({ error: 'The system provider or selected skill is unavailable.' })
    return
  }
  if (!(await consumeQuota(caller.id, 'ai'))) {
    sendQuotaExceeded(res)
    return
  }

  const now = new Date().toISOString()
  const { error: cleanupError } = await admin
    .from('skill_course_generation_jobs')
    .delete()
    .lt('expires_at', now)
  if (cleanupError) console.error('skill course generation job cleanup failed:', cleanupError)
  await failStalledJobs(admin)

  const { data: job, error: insertError } = await admin
    .from('skill_course_generation_jobs')
    .insert({
      requested_by: caller.id,
      organisation_id: organisationId,
      skill_library_id: skillId,
      knowledge_level: level,
    })
    .select('id')
    .single()
  if (insertError) {
    console.error('skill course generation job creation failed:', insertError)
    res.status(500).json({ error: 'Could not start the course generation job.' })
    return
  }

  waitUntil(runGenerationJob({
    jobId: job.id,
    request,
    userId: caller.id,
    organisationId,
  }))
  res.status(202).json({ jobId: job.id })
}

async function readJob(req, res, caller) {
  const jobId = req.query?.jobId
  if (typeof jobId !== 'string' || !UUID_PATTERN.test(jobId)) {
    res.status(400).json({ error: 'Invalid generation job.' })
    return
  }
  await failStalledJobs(supabaseAdmin(), { jobId, requestedBy: caller.id })
  const { data: job, error } = await supabaseAdmin()
    .from('skill_course_generation_jobs')
    .select('status, draft, error_message')
    .eq('id', jobId)
    .eq('requested_by', caller.id)
    // Expired jobs are gone as far as the caller is concerned, swept or not.
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    console.error('skill course generation job read failed:', error)
    res.status(500).json({ error: 'Could not read the generation job.' })
    return
  }
  if (!job) {
    res.status(404).json({ error: 'Generation job not found or expired.' })
    return
  }
  res.status(200).json({
    status: job.status,
    draft: job.status === 'completed' ? job.draft : undefined,
    error: job.status === 'failed' ? job.error_message : undefined,
  })
}

async function abortJobs(req, res, caller) {
  const rawIds = req.body?.jobIds
  const jobIds = Array.isArray(rawIds) ? [...new Set(rawIds)] : []
  if (jobIds.length === 0 || jobIds.some((id) => typeof id !== 'string') || jobIds.length > 10 || jobIds.some((id) => !UUID_PATTERN.test(id))) {
    res.status(400).json({ error: 'Select valid generation jobs to abort.' })
    return
  }
  const now = new Date().toISOString()
  const admin = supabaseAdmin()
  const { error } = await admin
    .from('skill_course_generation_jobs')
    .update({ status: 'cancelled', draft: null, error_message: null, updated_at: now, completed_at: now })
    .in('id', jobIds)
    .eq('requested_by', caller.id)
    // A finished draft not yet saved can still be abandoned. Saving goes through
    // save_generated_skill_course_job, which locks the same row, so a save and
    // an abort can't both win: once saved, the job is no longer 'completed'.
    .in('status', ['queued', 'running', 'completed'])
  if (error) {
    console.error('skill course generation job abort failed:', error)
    res.status(500).json({ error: 'Could not abort the course build.' })
    return
  }

  const { data: jobs, error: readError } = await admin
    .from('skill_course_generation_jobs')
    .select('id, status')
    .in('id', jobIds)
    .eq('requested_by', caller.id)
  if (readError) {
    console.error('skill course generation aborted status read failed:', readError)
    res.status(500).json({ error: 'The abort was sent, but its status could not be confirmed.' })
    return
  }
  res.status(200).json({ jobs: jobs ?? [] })
}

export default async function skillCourseGenerationJobHandler(req, res) {
  const caller = await platformAdminCaller(req, res)
  if (!caller) return

  if (req.method === 'GET') return readJob(req, res, caller)
  if (req.method === 'POST' && req.body?.action === 'abort') return abortJobs(req, res, caller)
  if (req.method === 'POST') return startJob(req, res, caller)

  res.status(405).json({ error: 'Method not allowed' })
}

export { runGenerationJob }
