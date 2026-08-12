// skills(user_id, lower(name)) has a unique index (0023) — this checks
// whether an insert/update failed because of it, so every skill-creation
// entry point can show the same clear message instead of a raw DB error.
export function isDuplicateSkillNameError(error) {
  return error?.code === '23505' && error?.message?.includes('skills_user_id_name_lower_idx')
}

export function duplicateSkillMessage(name) {
  return `You already have "${name.trim()}" in your skills — edit it from your Skills list instead of adding it again.`
}
