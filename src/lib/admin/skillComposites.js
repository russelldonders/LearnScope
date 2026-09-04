import { supabase } from '../supabaseClient'

const DEFINITION_SELECT = `
  id, parent_skill_id, organisation_id, version, status, created_at, published_at,
  skill_composite_components(
    id, component_skill_id, is_required, target_level, contribution_weight, sort_order,
    skill_library:component_skill_id(id, skill_code, name, category, status, organisation_id)
  )
`

function mapDefinition(definition) {
  if (!definition) return null
  return {
    ...definition,
    components: (definition.skill_composite_components ?? [])
      .filter((component) => component.skill_library)
      .sort((a, b) => a.sort_order - b.sort_order || a.skill_library.name.localeCompare(b.skill_library.name)),
  }
}

export async function getSkillCompositeDefinitions(parentSkillId) {
  const { data, error } = await supabase
    .from('skill_composite_definitions')
    .select(DEFINITION_SELECT)
    .eq('parent_skill_id', parentSkillId)
    .in('status', ['draft', 'published'])
    .order('version', { ascending: false })
  if (error) throw error

  const definitions = (data ?? []).map(mapDefinition)
  return {
    draft: definitions.find((definition) => definition.status === 'draft') ?? null,
    published: definitions.find((definition) => definition.status === 'published') ?? null,
  }
}

export async function createSkillCompositeDraft(parentSkillId) {
  const { data, error } = await supabase.rpc('create_skill_composite_draft', {
    p_parent_skill_id: parentSkillId,
  })
  if (error) throw error
  return data
}

export async function addSkillCompositeComponent(
  definitionId,
  componentSkillId,
  userId,
  { required = true, targetLevel = 1, sortOrder = 0 } = {}
) {
  const { data, error } = await supabase
    .from('skill_composite_components')
    .insert({
      definition_id: definitionId,
      component_skill_id: componentSkillId,
      is_required: required,
      target_level: targetLevel,
      sort_order: sortOrder,
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function updateSkillCompositeComponent(componentId, fields) {
  const update = {}
  if (fields.required !== undefined) update.is_required = fields.required
  if (fields.targetLevel !== undefined) update.target_level = fields.targetLevel
  if (fields.sortOrder !== undefined) update.sort_order = fields.sortOrder

  const { error } = await supabase
    .from('skill_composite_components')
    .update(update)
    .eq('id', componentId)
  if (error) throw error
}

export async function removeSkillCompositeComponent(componentId) {
  const { error } = await supabase
    .from('skill_composite_components')
    .delete()
    .eq('id', componentId)
  if (error) throw error
}

export async function publishSkillComposite(definitionId) {
  const { error } = await supabase.rpc('publish_skill_composite', {
    p_definition_id: definitionId,
  })
  if (error) throw error
}
