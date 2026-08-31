import { XAPI_VERBS } from './xapiVerbs'

export const SKILL_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/skill'
export const EXPERIENCE_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/experience'
export const DIAGNOSTIC_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/diagnostic'
// Generic (not Strava-specific) so any future external connector reuses the
// same shape -- marks a statement as synced from an external data source
// rather than typed in by hand, and carries the source's own activity id so
// a later sync can tell it's already been imported.
export const PROVENANCE_EXTENSION_IRI = 'https://learnscope.app/xapi/extensions/provenance'

// True for statements an automated diagnostic generated (e.g. the
// Confirming Baseline knowledge-check quiz, see skillDiagnostics.js) rather
// than something the learner deliberately logged as practical activity.
// These must never count as practical-axis evidence -- Up Next's "Record an
// activity", the application-history summary, or the AI baseline/validation
// synthesis -- since they're knowledge-axis by construction. Matched on the
// extension rather than the verb, since "Assessed" is also a normal verb
// choice in the freeform Record Activity picker and a genuine practical
// activity logged with that verb must not be excluded.
export function isDiagnosticStatement(statement) {
  return Boolean(statement?.result?.extensions?.[DIAGNOSTIC_EXTENSION_IRI])
}

// Statements about the same real-world activity (same name, same related
// skill) should share one Activity id so anything consuming the
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

function buildActivityId(activityName, relatedSkill) {
  const scope = relatedSkill ? `skill-${relatedSkill.id}` : 'general'
  return `https://learnscope.app/activities/${scope}/${activitySlug(activityName)}`
}

// xAPI represents how long an activity took as result.duration, an ISO 8601
// duration string (e.g. "PT1H30M") rather than a plain number -- this stays
// in that format rather than inventing a separate minutes/hours field.
export function buildDuration(hours, minutes) {
  const h = Math.max(0, Math.floor(Number(hours) || 0))
  const m = Math.max(0, Math.floor(Number(minutes) || 0))
  if (h === 0 && m === 0) return null
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 ? `${m}M` : ''}`
}

const DURATION_PATTERN = /^PT(?:(\d+)H)?(?:(\d+)M)?$/

export function formatDuration(statement) {
  const iso = statement.result?.duration
  if (!iso) return null
  const match = DURATION_PATTERN.exec(iso)
  if (!match) return null
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2] || 0)
  if (hours === 0 && minutes === 0) return null
  return [hours > 0 ? `${hours}h` : null, minutes > 0 ? `${minutes}m` : null].filter(Boolean).join(' ')
}

// Builds a spec-shaped xAPI statement from the guided-form fields.
// actor: { name, email }. verbValue: one of XAPI_VERBS[].value.
// relatedSkill: optional { id, name } recorded as a context extension.
export function buildStatement({
  actor,
  verbValue,
  activityName,
  description,
  timestamp,
  relatedSkill,
  relatedExperience,
  provenance,
  durationHours,
  durationMinutes,
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
      id: buildActivityId(activityName, relatedSkill),
      objectType: 'Activity',
      definition: {
        name: { 'en-US': activityName },
        description: description ? { 'en-US': description } : undefined,
      },
    },
    timestamp: new Date(timestamp).toISOString(),
  }

  const duration = buildDuration(durationHours, durationMinutes)
  if (duration) statement.result = { duration }

  if (relatedSkill || relatedExperience || provenance) {
    statement.context = { extensions: {} }
    if (relatedSkill) {
      statement.context.extensions[SKILL_EXTENSION_IRI] = { id: relatedSkill.id, name: relatedSkill.name }
    }
    if (relatedExperience) {
      statement.context.extensions[EXPERIENCE_EXTENSION_IRI] = {
        id: relatedExperience.id,
        title: relatedExperience.title,
        type: relatedExperience.type,
        // A subject or project's parent (the education/job it belongs to)
        // is captured alongside it, not looked up live -- so wherever this
        // statement is later shown (dashboard, /activity, the skill page)
        // the full experience trail is available without an extra join,
        // and stays accurate to what it was at the time the activity was
        // logged even if the parent is later renamed.
        ...(relatedExperience.parent
          ? { parent: { id: relatedExperience.parent.id, title: relatedExperience.parent.title, type: relatedExperience.parent.type } }
          : {}),
      }
    }
    if (provenance) {
      statement.context.extensions[PROVENANCE_EXTENSION_IRI] = { source: provenance.source, externalId: provenance.externalId }
    }
  }

  return statement
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

export function relatedExperienceFromStatement(statement) {
  return statement.context?.extensions?.[EXPERIENCE_EXTENSION_IRI] ?? null
}

export function provenanceFromStatement(statement) {
  return statement.context?.extensions?.[PROVENANCE_EXTENSION_IRI] ?? null
}

// "Advanced Databases · Computer Science BSc" rather than just "Advanced
// Databases" -- a subject or project name alone doesn't say which
// education/job it belongs to, especially once someone has more than one.
export function experienceTrail(relatedExperience) {
  if (!relatedExperience) return ''
  return relatedExperience.parent
    ? `${relatedExperience.title} · ${relatedExperience.parent.title}`
    : relatedExperience.title
}
