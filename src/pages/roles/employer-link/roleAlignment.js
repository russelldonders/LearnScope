// Pure computation, kept local to this feature: which of a role profile's
// required skills the learner already meets ("aligned") vs. hasn't reached
// yet ("gaps") -- compares against the learner's own skill levels, never
// mutates either side. A skill the learner doesn't track at all is a gap
// with learnerLevel: null, not an error.
export function computeRoleAlignment(learnerSkills, requiredSkills) {
  const levelBySkillId = new Map(learnerSkills.map((s) => [s.skillId, s.level]))
  const aligned = []
  const gaps = []

  for (const requirement of requiredSkills) {
    const learnerLevel = levelBySkillId.get(requirement.skillId) ?? null
    const entry = { ...requirement, learnerLevel }
    if (learnerLevel !== null && learnerLevel >= requirement.targetLevel) {
      aligned.push(entry)
    } else {
      gaps.push(entry)
    }
  }

  return { aligned, gaps }
}
