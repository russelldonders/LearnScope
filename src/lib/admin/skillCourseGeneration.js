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

export async function generateSkillCourseDraft(brief, organisationId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Sign in and try again.')
  const response = await fetch('/api/generate-skill-course-draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ...brief, organisationId }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Failed to generate the level course.')
  return body.draft
}

export async function createGeneratedSkillCourse({ skillId, level, draft, publishGlobal }) {
  const { data, error } = await supabase.rpc('create_generated_skill_course', {
    p_skill_library_id: skillId,
    p_level: level,
    p_draft: draft,
    p_publish_global: publishGlobal,
  })
  if (error) throw error
  return data
}

export async function publishSystemCourseToGlobal(courseId) {
  const { error } = await supabase.rpc('publish_system_course_to_global', {
    p_course_id: courseId,
  })
  if (error) throw error
}
