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

// The forward-moving progression shown as a stepper on a skill's page.
// at_risk/archived are exception/terminal states outside the normal flow,
// so they're excluded here and surfaced separately instead.
export const SKILL_LIFECYCLE_FLOW_STAGES = SKILL_LIFECYCLE_STAGES.filter(
  (s) => s.value !== 'at_risk' && s.value !== 'archived'
)
