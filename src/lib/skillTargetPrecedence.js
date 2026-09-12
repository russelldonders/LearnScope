// Reconciles an employer-set target (role profile requirement or direct
// suggestion, whichever is higher -- see getEmployerTargetsForUser) against
// the learner's own personal skill_targets history into the single "visible
// target" the skills UI should show. An employer target only counts as met
// once it's been confirmed by an employer admin (employerConfirmedLevel,
// from employer_skill_confirmations) -- a self-assessment isn't enough,
// since the employer is the one who set the bar. Once met, the learner's
// own higher target (if any) takes back over; employerTargetMet stays true
// either way so the UI can still note the employer target was reached.
export function computeVisibleTarget({
  employerTargetLevel = null,
  employerConfirmedLevel = null,
  personalTargetLevel = null,
} = {}) {
  if (employerTargetLevel == null) {
    return personalTargetLevel == null
      ? null
      : { level: personalTargetLevel, source: 'personal', employerTargetLevel: null, employerTargetMet: false }
  }

  const employerTargetMet = employerConfirmedLevel != null && employerConfirmedLevel >= employerTargetLevel

  if (employerTargetMet && personalTargetLevel != null && personalTargetLevel > employerTargetLevel) {
    return { level: personalTargetLevel, source: 'personal', employerTargetLevel, employerTargetMet: true }
  }

  return { level: employerTargetLevel, source: 'employer', employerTargetLevel, employerTargetMet }
}
