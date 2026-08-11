export const SKILL_RELATIONSHIPS = [
  { value: 'first_acquired', label: 'First acquired' },
  { value: 'developed', label: 'Developed' },
  { value: 'applied', label: 'Applied' },
  { value: 'demonstrated', label: 'Demonstrated' },
]

export const SKILL_RELATIONSHIP_LABELS = Object.fromEntries(
  SKILL_RELATIONSHIPS.map((r) => [r.value, r.label])
)
