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

// Practical-axis GrowthRing color per trust tier -- how well-supported the
// displayed level is, shown as color rather than just the caption text
// underneath. Self-assessed/evidence-supported/confirmed step up the same
// green ramp toward --color-moss; validated breaks to --color-slate so it
// reads as a distinct kind of trust rather than just "darker green".
export const TRUST_STATUS_COLORS = {
  [TRUST_STATUS.SELF_ASSESSED]: 'var(--color-trust-self)',
  [TRUST_STATUS.EVIDENCE_SUPPORTED]: 'var(--color-trust-evidence)',
  [TRUST_STATUS.CONFIRMED]: 'var(--color-moss)',
  [TRUST_STATUS.VALIDATED]: 'var(--color-slate)',
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

// The Validated tier means a person confirmed the skill: a
// skill_validation_requests row a validator accepted. An AI check that
// passed also moves the lifecycle on to maintaining, but it's a synthesis of
// the learner's own evidence, not independent verification -- so on its own
// it earns whatever tier that evidence supports, never Validated.
export function isPersonValidated(lifecycleStage, hasConfirmedValidation) {
  return Boolean(hasConfirmedValidation) && ['validated', 'maintained'].includes(lifecycleStage)
}
