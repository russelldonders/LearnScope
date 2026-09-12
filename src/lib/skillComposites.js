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

// The reverse of the above: given a skill the learner tracks, which
// published composite(s) is it a component of? Lets a component skill's own
// page say "part of {parent}" so the parent capability stays discoverable
// even though the learner arrived here directly. The parent may or may not
// be a skill this learner tracks themselves -- only link to it when it is.
export async function getParentCompositesForSkill(componentLibrarySkillId, userId) {
  if (!componentLibrarySkillId || !userId) return []

  const { data: componentRows, error: componentError } = await supabase
    .from('skill_composite_components')
    .select('definition_id, skill_composite_definitions!inner(id, parent_skill_id, status, skill_library:parent_skill_id(id, name))')
    .eq('component_skill_id', componentLibrarySkillId)
    .eq('skill_composite_definitions.status', 'published')
  if (componentError) throw componentError

  const parents = (componentRows ?? [])
    .map((row) => row.skill_composite_definitions?.skill_library)
    .filter(Boolean)
  if (parents.length === 0) return []

  const parentLibraryIds = [...new Set(parents.map((parent) => parent.id))]
  const { data: trackedRows, error: trackedError } = await supabase
    .from('skills')
    .select('id, library_skill_id')
    .eq('user_id', userId)
    .in('library_skill_id', parentLibraryIds)
  if (trackedError) throw trackedError
  const trackedSkillIdByLibraryId = new Map((trackedRows ?? []).map((row) => [row.library_skill_id, row.id]))

  const seen = new Set()
  return parents
    .filter((parent) => (seen.has(parent.id) ? false : (seen.add(parent.id), true)))
    .map((parent) => ({
      librarySkillId: parent.id,
      name: parent.name,
      trackedSkillId: trackedSkillIdByLibraryId.get(parent.id) ?? null,
    }))
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
