import { supabase } from './supabaseClient'
import { buildCompositeProgress } from './skillCompositeProgress'

const PUBLISHED_DEFINITION_SELECT = `
  id, parent_skill_id, version, published_at,
  skill_composite_components(
    id, component_skill_id, is_required, target_level, contribution_weight, sort_order,
    skill_library:component_skill_id(id, skill_code, name, category)
  )
`

export async function getLearnerCompositeProgress(parentSkillId, userId) {
  if (!parentSkillId || !userId) return null
  const progressBySkillId = await getLearnerCompositeProgressForSkills([parentSkillId], userId)
  return progressBySkillId[parentSkillId] ?? null
}

export async function getLearnerCompositeProgressForSkills(parentSkillIds, userId) {
  const requestedIds = [...new Set((parentSkillIds ?? []).filter(Boolean))]
  if (requestedIds.length === 0 || !userId) return {}

  const { data: definitionRows, error: definitionError } = await supabase
    .from('skill_composite_definitions')
    .select(PUBLISHED_DEFINITION_SELECT)
    .eq('status', 'published')
    .limit(1000)
  if (definitionError) throw definitionError
  const definitions = (definitionRows ?? []).map((definition) => ({
    id: definition.id,
    parentSkillId: definition.parent_skill_id,
    version: definition.version,
    publishedAt: definition.published_at,
    components: (definition.skill_composite_components ?? [])
      .filter((component) => component.skill_library)
      .sort((a, b) => a.sort_order - b.sort_order || a.skill_library.name.localeCompare(b.skill_library.name))
      .map((component) => ({
        id: component.id,
        librarySkillId: component.component_skill_id,
        skillCode: component.skill_library.skill_code,
        name: component.skill_library.name,
        category: component.skill_library.category,
        isRequired: component.is_required,
        targetLevel: component.target_level,
        contributionWeight: Number(component.contribution_weight),
      })),
  }))
  if (!definitions.some((definition) => requestedIds.includes(definition.parentSkillId))) return {}

  const componentLibraryIds = [...new Set(definitions.flatMap((definition) =>
    definition.components.map((component) => component.librarySkillId)
  ))]

  let trackedSkills = []
  if (componentLibraryIds.length > 0) {
    const { data, error } = await supabase
      .from('skills')
      .select('id, library_skill_id, level, lifecycle_stage')
      .eq('user_id', userId)
      .in('library_skill_id', componentLibraryIds)
    if (error) throw error
    trackedSkills = data ?? []
  }

  const trackedSkillIds = trackedSkills.map((skill) => skill.id)
  let assessments = []
  if (trackedSkillIds.length > 0) {
    const { data, error } = await supabase
      .from('skill_assessments')
      .select('skill_id, level, axis, assessed_at')
      .in('skill_id', trackedSkillIds)
      .order('assessed_at', { ascending: false })
    if (error) throw error
    assessments = data ?? []
  }

  const latestPracticalBySkillId = new Map()
  for (const assessment of assessments) {
    if (assessment.axis === 'knowledge' || latestPracticalBySkillId.has(assessment.skill_id)) continue
    latestPracticalBySkillId.set(assessment.skill_id, assessment.level)
  }

  const trackedByLibraryId = new Map(trackedSkills.map((skill) => [skill.library_skill_id, {
    trackedSkillId: skill.id,
    lifecycleStage: skill.lifecycle_stage,
    currentLevel: skill.level ?? latestPracticalBySkillId.get(skill.id) ?? null,
  }]))

  return Object.fromEntries(
    requestedIds
      .map((parentSkillId) => [parentSkillId, buildCompositeProgress(definitions, parentSkillId, trackedByLibraryId)])
      .filter(([, progress]) => progress)
  )
}
