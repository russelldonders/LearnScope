import { supabase } from './supabaseClient'
import { calculateCompositeCoverage } from './skillCompositeProgress'

const PUBLISHED_DEFINITION_SELECT = `
  id, parent_skill_id, version, published_at,
  skill_composite_components(
    id, component_skill_id, is_required, target_level, contribution_weight, sort_order,
    skill_library:component_skill_id(id, skill_code, name, category)
  )
`

export async function getLearnerCompositeProgress(parentSkillId, userId) {
  if (!parentSkillId || !userId) return null

  const { data: definition, error: definitionError } = await supabase
    .from('skill_composite_definitions')
    .select(PUBLISHED_DEFINITION_SELECT)
    .eq('parent_skill_id', parentSkillId)
    .eq('status', 'published')
    .maybeSingle()
  if (definitionError) throw definitionError
  if (!definition) return null

  const definitionComponents = (definition.skill_composite_components ?? [])
    .filter((component) => component.skill_library)
    .sort((a, b) => a.sort_order - b.sort_order || a.skill_library.name.localeCompare(b.skill_library.name))
  const componentLibraryIds = definitionComponents.map((component) => component.component_skill_id)

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

  const trackedByLibraryId = new Map(trackedSkills.map((skill) => [skill.library_skill_id, skill]))
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

  const components = definitionComponents.map((component) => {
    const trackedSkill = trackedByLibraryId.get(component.component_skill_id) ?? null
    const currentLevel = trackedSkill?.level ?? latestPracticalBySkillId.get(trackedSkill?.id) ?? null
    return {
      id: component.id,
      librarySkillId: component.component_skill_id,
      skillCode: component.skill_library.skill_code,
      name: component.skill_library.name,
      category: component.skill_library.category,
      isRequired: component.is_required,
      targetLevel: component.target_level,
      contributionWeight: Number(component.contribution_weight),
      trackedSkillId: trackedSkill?.id ?? null,
      lifecycleStage: trackedSkill?.lifecycle_stage ?? null,
      currentLevel,
      targetMet: currentLevel != null && currentLevel >= component.target_level,
    }
  })

  return {
    id: definition.id,
    version: definition.version,
    publishedAt: definition.published_at,
    components,
    coverage: calculateCompositeCoverage(components),
  }
}
