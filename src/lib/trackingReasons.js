export const TRACKING_REASONS = [
  { value: 'work', label: 'Work' },
  { value: 'career_development', label: 'Career Development' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'personal_interest', label: 'Personal Interest' },
]

export const TRACKING_REASON_LABELS = Object.fromEntries(
  TRACKING_REASONS.map((r) => [r.value, r.label])
)
