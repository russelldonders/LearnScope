export const SKILL_LIFECYCLE_STAGES = [
  { value: 'identified', label: 'Identified' },
  { value: 'baseline_assessed', label: 'Baseline assessed' },
  { value: 'target_set', label: 'Target set' },
  { value: 'developing', label: 'Developing' },
  { value: 'demonstrated', label: 'Demonstrated' },
  { value: 'validated', label: 'Validated' },
  { value: 'maintained', label: 'Maintained' },
  { value: 'at_risk', label: 'At risk / Expired' },
  { value: 'archived', label: 'Archived' },
]

export const SKILL_LIFECYCLE_LABELS = Object.fromEntries(
  SKILL_LIFECYCLE_STAGES.map((s) => [s.value, s.label])
)

// What's currently underway while a skill sits in a given stage, framed as
// progress toward the next stage in the flow (rather than the stage's own
// name). Shown as the skill page subtitle instead of the static stage label.
export const SKILL_LIFECYCLE_ACTIVITY_LABELS = {
  identified: 'Assessing skill baseline',
  baseline_assessed: 'Setting skill targets',
  target_set: 'Developing skill',
  developing: 'Demonstrating skill',
  demonstrated: 'Validating skill',
  validated: 'Maintaining skill',
  maintained: 'Maintaining skill',
}

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
