import { XAPI_VERBS } from './xapiVerbs'

export const SKILL_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/skill'
export const COURSE_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/course'

// Statements about the same real-world activity (same name, same related
// skill/course) should share one Activity id so anything consuming the
// statements later -- an LRS, an export, a reporting query -- can recognise
// and aggregate them by inspecting the JSON alone, per xAPI's Activity
// concept. Deriving it from the name + context keeps it deterministic
// without needing a lookup table of previously-used ids.
function activitySlug(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'activity'
  )
}

function buildActivityId(activityName, relatedSkill, relatedCourse) {
  const scope = relatedSkill ? `skill-${relatedSkill.id}` : relatedCourse ? `course-${relatedCourse.id}` : 'general'
  return `https://learnscope.app/activities/${scope}/${activitySlug(activityName)}`
}

// Builds a spec-shaped xAPI statement from the guided-form fields.
// actor: { name, email }. verbValue: one of XAPI_VERBS[].value.
// relatedSkill/relatedCourse: optional { id, name } recorded as context extensions.
export function buildStatement({
  actor,
  verbValue,
  activityName,
  description,
  timestamp,
  relatedSkill,
  relatedCourse,
}) {
  const verb = XAPI_VERBS.find((v) => v.value === verbValue)
  if (!verb) throw new Error('Choose a valid verb.')

  const statement = {
    id: crypto.randomUUID(),
    actor: {
      objectType: 'Agent',
      name: actor.name || undefined,
      mbox: actor.email ? `mailto:${actor.email}` : undefined,
    },
    verb: {
      id: verb.iri,
      display: { 'en-US': verb.label },
    },
    object: {
      id: buildActivityId(activityName, relatedSkill, relatedCourse),
      objectType: 'Activity',
      definition: {
        name: { 'en-US': activityName },
        description: description ? { 'en-US': description } : undefined,
      },
    },
    timestamp: new Date(timestamp).toISOString(),
  }

  if (relatedSkill || relatedCourse) {
    const extensions = {}
    if (relatedSkill) extensions[SKILL_EXTENSION_IRI] = { id: relatedSkill.id, name: relatedSkill.name }
    if (relatedCourse) extensions[COURSE_EXTENSION_IRI] = { id: relatedCourse.id, name: relatedCourse.name }
    statement.context = { extensions }
  }

  return statement
}

// Minimal structural check for statements typed/pasted in raw JSON mode.
export function validateStatement(statement) {
  if (!statement || typeof statement !== 'object') return 'Statement must be a JSON object.'
  if (!statement.verb?.id) return 'Statement is missing verb.id.'
  if (!statement.object?.definition?.name) return 'Statement is missing object.definition.name.'
  if (!statement.timestamp || Number.isNaN(Date.parse(statement.timestamp))) {
    return 'Statement is missing a valid timestamp.'
  }
  return null
}

export function activityName(statement) {
  const names = statement.object?.definition?.name
  if (!names) return '(untitled activity)'
  return names['en-US'] ?? Object.values(names)[0] ?? '(untitled activity)'
}

export function verbLabel(statement) {
  const displays = statement.verb?.display
  if (displays) return displays['en-US'] ?? Object.values(displays)[0]
  return statement.verb?.id ?? '(verb)'
}

export function relatedSkillFromStatement(statement) {
  return statement.context?.extensions?.[SKILL_EXTENSION_IRI] ?? null
}

export function relatedCourseFromStatement(statement) {
  return statement.context?.extensions?.[COURSE_EXTENSION_IRI] ?? null
}
