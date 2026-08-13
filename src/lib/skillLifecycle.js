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
