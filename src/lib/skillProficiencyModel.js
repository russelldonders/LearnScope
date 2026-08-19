// Pure, deterministic derivations supporting the practical-primary /
// knowledge-foundation proficiency model -- no AI, no schema changes,
// reusing counts and dates that are already loaded elsewhere (same style as
// skillNextAction.js). Nothing here produces or feeds a numeric score; it
// only classifies and describes evidence that already exists.

export const TRUST_STATUS = {
  SELF_ASSESSED: 'Self-assessed',
  EVIDENCE_SUPPORTED: 'Evidence supported',
  CONFIRMED: 'Confirmed',
  VALIDATED: 'Validated',
}

// Trust status is tracked independently per axis and is deliberately not a
// proficiency score -- it says how well-supported the displayed level is,
// not how high it is. Callers on a single skill (which already load peer
// ratings, activity, etc.) can pass the fuller set of inputs; callers
// working from a lighter skill-list query can omit evidenceCount/
// peerRatingsCount and still get a coarser but honest answer -- missing
// inputs default to 0/false rather than being required.
//
// AI-synthesized levels (source 'ai_baseline'/'ai_evaluation') do NOT count
// toward peerRatingsCount/formallyValidated here -- an AI inference is
// derived from evidence, it isn't itself an independent confirmation.
export function computeTrustStatus({
  axis,
  selfAssessedCount = 0,
  evidenceCount = 0,
  peerRatingsCount = 0,
  knowledgeConfirmed = false,
  formallyValidated = false,
}) {
  if (axis === 'knowledge') {
    // Validated isn't reachable yet -- there's no formal per-dimension
    // knowledge validator flow (see skillProficiencyModel follow-up notes).
    // That's intentional: don't infer a validation that hasn't happened.
    if (knowledgeConfirmed) return TRUST_STATUS.CONFIRMED
    if (selfAssessedCount > 0) return TRUST_STATUS.SELF_ASSESSED
    return null
  }
  if (formallyValidated) return TRUST_STATUS.VALIDATED
  if (peerRatingsCount > 0) return TRUST_STATUS.CONFIRMED
  if (evidenceCount > 0) return TRUST_STATUS.EVIDENCE_SUPPORTED
  if (selfAssessedCount > 0) return TRUST_STATUS.SELF_ASSESSED
  return null
}

// "Fully validated" requires both dimensions to independently be at the
// Validated tier. Correctly unreachable today (knowledge caps at Confirmed)
// -- not a bug, a placeholder for the per-dimension validation follow-up.
export function isFullyValidated({ practicalStatus, knowledgeStatus }) {
  return practicalStatus === TRUST_STATUS.VALIDATED && knowledgeStatus === TRUST_STATUS.VALIDATED
}

// How many days apart the first and last activity need to be before it
// reads as "demonstrated over time" rather than just "repeated" -- named so
// the threshold isn't a magic number buried in a condition.
const REPEAT_SPAN_DAYS = 30

// Classifies practical application history from xAPI activity records
// (recorded_at dates only) -- deliberately never turns a count into a level.
// One demonstration is "First attempt"; more than one is "Repeated
// demonstration"; if they span more than REPEAT_SPAN_DAYS it becomes
// "Demonstrated over time" instead, since that's stronger evidence of
// reliability than several attempts logged in one sitting.
export function classifyApplicationHistory(xapiStatements) {
  const records = xapiStatements ?? []
  if (records.length === 0) {
    return { count: 0, firstDate: null, lastDate: null, label: null }
  }
  const dates = records.map((s) => new Date(s.recorded_at)).sort((a, b) => a - b)
  const firstDate = dates[0]
  const lastDate = dates[dates.length - 1]
  const spanDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24)
  let label
  if (records.length <= 1) label = 'First attempt'
  else if (spanDays > REPEAT_SPAN_DAYS) label = 'Demonstrated over time'
  else label = 'Repeated demonstration'
  return { count: records.length, firstDate, lastDate, label }
}

// Human-readable one-line summary of application history, for the skill
// header ("Demonstrated 3 times over 6 weeks"). Returns null when there's
// nothing recorded yet -- callers should just omit the line in that case.
export function describeApplicationHistory(history) {
  if (!history?.label || history.count === 0) return null
  if (history.label === 'First attempt') return 'One activity logged so far.'
  if (history.label === 'Repeated demonstration') return `Demonstrated ${history.count} times.`
  const spanDays = Math.round((history.lastDate - history.firstDate) / (1000 * 60 * 60 * 24))
  const weeks = Math.max(1, Math.round(spanDays / 7))
  const spanText = weeks < 8 ? `${weeks} week${weeks === 1 ? '' : 's'}` : `${Math.round(weeks / 4.345)} months`
  return `Demonstrated ${history.count} times over ${spanText}.`
}

// Classifies what an existing skill_assessments row's `source` (+ `axis`)
// supports -- the "evidence method" concept -- using only fields already on
// the row. Every method states what dimension it primarily supports; none
// are treated as proof of the other dimension.
const ASSESSMENT_SOURCE_METHODS = {
  self: { practical: 'Self-assessed', knowledge: 'Self-assessed' },
  course: { practical: 'Course achievement' },
  ai_baseline: { practical: 'AI-assessed baseline (from evidence, not an independent confirmation)' },
  ai_evaluation: { practical: 'AI assessment (from evidence, not an independent confirmation)' },
  diagnostic_confirmed: { knowledge: 'Knowledge checked' },
}

export function classifyAssessmentSource(source, axis) {
  const bySource = ASSESSMENT_SOURCE_METHODS[source]
  if (!bySource) return null
  return bySource[axis] ?? null
}
