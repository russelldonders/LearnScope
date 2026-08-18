// Labels name what's actually happening at each stage, not just the state's
// name -- validated and maintained intentionally share a label since both
// are "the skill is being kept current" from the learner's point of view,
// and the lifecycle stepper never shows both at once (see
// SKILL_LIFECYCLE_FLOW_STAGES / the "hide completed stages" behavior).
export const SKILL_LIFECYCLE_STAGES = [
  { value: 'identified', label: 'Establishing Baseline' },
  { value: 'confirming_baseline', label: 'Confirming Baseline' },
  { value: 'baseline_assessed', label: 'Target Setting' },
  { value: 'target_set', label: 'Developing' },
  { value: 'developing', label: 'Demonstrating' },
  { value: 'demonstrated', label: 'Validating' },
  { value: 'validated', label: 'Maintaining' },
  { value: 'maintained', label: 'Maintaining' },
  { value: 'at_risk', label: 'At risk / Expired' },
  { value: 'archived', label: 'Archived' },
]

export const SKILL_LIFECYCLE_LABELS = Object.fromEntries(
  SKILL_LIFECYCLE_STAGES.map((s) => [s.value, s.label])
)

// The forward-moving progression shown as a stepper on a skill's page.
// at_risk/archived are exception/terminal states outside the normal flow,
// so they're excluded here and surfaced separately instead.
export const SKILL_LIFECYCLE_FLOW_STAGES = SKILL_LIFECYCLE_STAGES.filter(
  (s) => s.value !== 'at_risk' && s.value !== 'archived'
)

const VALIDATED_INDEX = SKILL_LIFECYCLE_FLOW_STAGES.findIndex((s) => s.value === 'validated')

// How much extra credibility a peer rater's opinion should carry when they
// also track the same skill themselves, based on how far along their own
// copy is. Scales linearly from 1x (identified, i.e. no further along than
// a beginner) up to 3x once they've reached validated; maintained counts
// the same as validated since it's the sustained state after validation.
export function lifecycleWeight(stage) {
  const idx = SKILL_LIFECYCLE_FLOW_STAGES.findIndex((s) => s.value === stage)
  if (idx < 0) return 1
  const capped = Math.min(idx, VALIDATED_INDEX)
  return 1 + (capped / VALIDATED_INDEX) * 2
}
