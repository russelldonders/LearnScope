import { supabase } from '../supabaseClient'
import { KNOWLEDGE_LEVEL_LABELS } from '../levels'

export function buildSkillCourseBrief(skill, level, settings) {
  const label = KNOWLEDGE_LEVEL_LABELS[level]
  const currentGuide = skill.knowledge_level_guide?.[level - 1]
  const previousGuide = level > 1 ? skill.knowledge_level_guide?.[level - 2] : null
  const matrixContext = skill.knowledge_level_guide?.length === 5
    ? skill.knowledge_level_guide.map((statement, index) => `Level ${index + 1} — ${KNOWLEDGE_LEVEL_LABELS[index + 1]}: ${statement}`).join('\n')
    : 'No skill-specific matrix guidance has been saved yet.'

  return {
    topic: `${skill.name} — ${label}`,
    audience: level === 1
      ? `Learners who are new to ${skill.name} and are working toward Knowledge Level 1 (${label}).`
      : `Learners who already understand ${skill.name} at Knowledge Level ${level - 1} and are working toward Level ${level} (${label}).`,
    outcomes: [
      `Build the knowledge and understanding expected at Level ${level} (${label}) for ${skill.name}.`,
      currentGuide || `Explain the concepts a learner must understand at this level of ${skill.name}.`,
      previousGuide
        ? `Distinguish Level ${level} understanding from the previous level: ${previousGuide}`
        : `Recognise the core vocabulary, purpose and boundaries of ${skill.name}.`,
      'Check understanding through worked examples, reflection prompts and practical knowledge checks.',
    ].join('\n'),
    courseType: 'Online',
    durationValue: String(settings.durationValue),
    durationUnit: settings.durationUnit,
    sectionCount: String(settings.sectionCount),
    pagesPerSection: String(settings.pagesPerSection),
    tone: settings.tone,
    elements: settings.elements,
    elementAmount: settings.elementAmount,
    assessmentEnabled: settings.assessmentEnabled,
    assessmentQuestionCount: String(settings.assessmentQuestionCount),
    assessmentPassMark: String(settings.assessmentPassMark),
    assessmentPointsPerQuestion: String(settings.assessmentPointsPerQuestion),
    assessmentDisplayMode: settings.assessmentDisplayMode,
    assessmentQuestionTypes: settings.assessmentQuestionTypes,
    sourceMaterial: [
      `Skill: ${skill.name}`,
      skill.category ? `Category: ${skill.category}` : null,
      skill.description ? `Skill description: ${skill.description}` : null,
      `Target knowledge level: ${level} — ${label}`,
      `Target level guidance: ${currentGuide || 'Use the standard knowledge-level definition.'}`,
      `Full knowledge matrix:\n${matrixContext}`,
      'Keep this course focused on theoretical knowledge and understanding. Do not imply that completing it proves practical competence.',
    ].filter(Boolean).join('\n\n'),
  }
}

export async function getSystemProviderOrganisationId() {
  const { data, error } = await supabase
    .from('organisations')
    .select('id')
    .eq('is_system', true)
    .eq('status', 'active')
    .single()
  if (error) throw error
  return data.id
}

async function accessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')
  return session.access_token
}

async function jobRequest(path, options = {}) {
  const token = await accessToken()
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'The course generation request failed.')
  return body
}

export async function startSkillCourseGeneration({ brief, organisationId, skillId, level }) {
  const body = await jobRequest('/api/generate-skill-course-draft', {
    method: 'POST',
    body: JSON.stringify({ ...brief, organisationId, skillId, level }),
  })
  return body.jobId
}

export function getSkillCourseGenerationJob(jobId) {
  return jobRequest(`/api/generate-skill-course-draft?jobId=${encodeURIComponent(jobId)}`)
}

export function abortSkillCourseGeneration(jobIds) {
  if (jobIds.length === 0) return Promise.resolve({ jobs: [] })
  return jobRequest('/api/generate-skill-course-draft', {
    method: 'POST',
    body: JSON.stringify({ action: 'abort', jobIds }),
  })
}

export function skillCourseBuildAbortedError() {
  return Object.assign(new Error('Course build aborted.'), { code: 'COURSE_BUILD_ABORTED' })
}

export async function generateSkillCourseDraft(brief, organisationId, {
  skillId,
  level,
  onJobCreated,
  shouldAbort = () => false,
  pollInterval = 1_500,
} = {}) {
  const jobId = await startSkillCourseGeneration({ brief, organisationId, skillId, level })
  onJobCreated?.(jobId)

  let consecutivePollErrors = 0
  while (true) {
    if (shouldAbort()) {
      await abortSkillCourseGeneration([jobId]).catch(() => {})
      throw skillCourseBuildAbortedError()
    }
    if (pollInterval > 0) await new Promise((resolve) => setTimeout(resolve, pollInterval))
    let job
    try {
      job = await getSkillCourseGenerationJob(jobId)
      consecutivePollErrors = 0
    } catch (error) {
      consecutivePollErrors += 1
      if (consecutivePollErrors < 3) continue
      throw error
    }
    // The job id comes back with the draft: the course is saved from the job
    // (see saveGeneratedSkillCourseJob), not from the draft the browser holds.
    if (job.status === 'completed') return { jobId, draft: job.draft }
    if (job.status === 'failed') throw new Error(job.error || 'Failed to generate the level course.')
    if (job.status === 'cancelled') throw skillCourseBuildAbortedError()
  }
}

// Saves a finished generation job as a course. Saving and aborting lock the
// same job row, so an abort that lands first stops the save (and one that
// lands after finds the course already saved).
export async function saveGeneratedSkillCourseJob({ jobId, publishGlobal }) {
  const { data, error } = await supabase.rpc('save_generated_skill_course_job', {
    p_job_id: jobId,
    p_publish_global: publishGlobal,
  })
  if (error) {
    if (/aborted/i.test(error.message ?? '')) throw skillCourseBuildAbortedError()
    throw error
  }
  return data
}

export async function publishSystemCourseToGlobal(courseId) {
  const { error } = await supabase.rpc('publish_system_course_to_global', {
    p_course_id: courseId,
  })
  if (error) throw error
}
