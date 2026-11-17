import { supabase } from './supabaseClient'
import { KNOWLEDGE_LEVEL_LABELS, LEVEL_LABELS } from './levels'

// A plan's settings, reached from the cog in edit mode
// (20261117090000_0308_learner_plan_prerequisites_and_sequence.sql):
//
// Order (learner_plans.sequence): 'none' -- any order; 'plan' -- in order
// across the whole plan; 'sections' -- in order within each section. Which
// items that locks is worked out in planProgress.js (sequenceLocks).
//
// Prerequisites: groups that all need meeting, each met by any one of its
// options -- a skill library skill at a minimum level, or a catalogue course
// (any version). A group is 'guidance' (shown, met or not) or 'required'
// (until met, the plan's items stay locked and nothing can be ticked off).

export const PLAN_SEQUENCES = ['none', 'plan', 'sections']
export const PREREQUISITE_ENFORCEMENTS = ['guidance', 'required']

export async function setPlanSequence(planId, sequence) {
  if (!PLAN_SEQUENCES.includes(sequence)) throw new Error('Unknown plan order')
  const { error } = await supabase.from('learner_plans').update({ sequence }).eq('id', planId)
  if (error) throw error
}

// Every group with its options, each named and marked met (or not) from the
// viewer's own skills and courses.
export async function getPlanPrerequisites(planId) {
  const { data, error } = await supabase.rpc('get_learner_plan_prerequisites', { p_plan_id: planId })
  if (error) throw error
  return data ?? []
}

export async function addPrerequisiteGroup(planId, { enforcement = 'guidance', position = 0 } = {}) {
  const { data, error } = await supabase
    .from('learner_plan_prerequisite_groups')
    .insert({ plan_id: planId, enforcement, position })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function setPrerequisiteGroupEnforcement(groupId, enforcement) {
  if (!PREREQUISITE_ENFORCEMENTS.includes(enforcement)) throw new Error('Unknown prerequisite setting')
  const { error } = await supabase.from('learner_plan_prerequisite_groups').update({ enforcement }).eq('id', groupId)
  if (error) throw error
}

// Removes the group and its options; nothing else.
export async function removePrerequisiteGroup(groupId) {
  const { error } = await supabase.from('learner_plan_prerequisite_groups').delete().eq('id', groupId)
  if (error) throw error
}

const levelOrNull = (value) => (value ? Number(value) : null)

export async function addPrerequisite(planId, groupId, { kind, librarySkillId, catalogueCourseId, minPracticalLevel, minKnowledgeLevel }) {
  const row = { plan_id: planId, group_id: groupId, kind }
  if (kind === 'skill') {
    row.library_skill_id = librarySkillId
    row.min_practical_level = levelOrNull(minPracticalLevel)
    row.min_knowledge_level = levelOrNull(minKnowledgeLevel)
  } else {
    row.catalogue_course_id = catalogueCourseId
  }
  const { error } = await supabase.from('learner_plan_prerequisites').insert(row)
  if (error) throw error
}

export async function removePrerequisite(prerequisiteId) {
  const { error } = await supabase.from('learner_plan_prerequisites').delete().eq('id', prerequisiteId)
  if (error) throw error
}

// Where the viewer stands: each group met when any option is (a group with
// no options yet asks nothing), `blocked` while a required group isn't met.
export function summarisePrerequisites(groups) {
  const counted = (groups ?? []).filter((group) => group.options?.length > 0)
  const summarised = counted.map((group) => ({ ...group, met: group.options.some((option) => option.met) }))
  return {
    groups: summarised,
    any: summarised.length > 0,
    allMet: summarised.every((group) => group.met),
    blocked: summarised.some((group) => group.enforcement === 'required' && !group.met),
  }
}

// What one prerequisite option asks for, in a line.
export function prerequisiteLabel(option, t) {
  if (option.kind === 'course') return t('plans.settings.courseOption', { name: option.name ?? t('plans.settings.unknownCourse') })
  const levels = [
    option.min_practical_level && t('plans.abilityLevelValue', { level: LEVEL_LABELS[option.min_practical_level] ?? option.min_practical_level }),
    option.min_knowledge_level && t('plans.knowledgeLevelValue', { level: KNOWLEDGE_LEVEL_LABELS[option.min_knowledge_level] ?? option.min_knowledge_level }),
  ].filter(Boolean)
  return t('plans.settings.skillOption', { name: option.name ?? t('plans.settings.unknownSkill'), levels: levels.join(' · ') })
}
