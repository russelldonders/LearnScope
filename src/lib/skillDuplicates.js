// skills(user_id, lower(name)) has a unique index (0023) — this checks
// whether an insert/update failed because of it, so every skill-creation
// entry point can show the same clear message instead of a raw DB error.
export function isDuplicateSkillNameError(error) {
  return error?.code === '23505' && error?.message?.includes('skills_user_id_name_lower_idx')
}

export function duplicateSkillMessage(name) {
  return `You already have "${name.trim()}" in your skills — edit it from your Skills list instead of adding it again.`
}

// Normalises the same way the unique index compares (lower(name)), after
// trimming -- the trimmed name is also what gets saved.
export function skillNameKey(name) {
  return (name ?? '').trim().toLowerCase()
}

// For a batch insert (e.g. CV import): trims each name, drops blank names,
// skills already in `existingNames` (a Set of skillNameKey values), and any
// repeat within the batch itself (first one wins) -- so one batch can never
// collide with skills_user_id_name_lower_idx on its own.
export function uniqueNewSkills(skills, existingNames = new Set()) {
  const seen = new Set(existingNames)
  const result = []
  for (const skill of skills) {
    const name = (skill.name ?? '').trim()
    const key = skillNameKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push({ ...skill, name })
  }
  return result
}
