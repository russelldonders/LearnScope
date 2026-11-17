// Plain-language descriptions of organisation capabilities, used by the
// create/edit organisation forms (OrganisationCapabilityFields). Each option
// says what it actually changes in that organisation's workspace today --
// kept in step with where each capability is really checked:
//   - employs_people: EmployerConsole's Role profiles section (workforceOnly),
//     get_employer_login_context (branded employee sign-in/home),
//     private.sharing_employer_directory (providers' "share with an
//     employer" list) and get_public_employer_catalogue_courses (courses on
//     the public organisation page);
//   - the other three aren't checked anywhere yet, so they say so rather
//     than implying they switch features on or off.
// `requires` mirrors set_organisation_capabilities/create_organisation,
// which add the prerequisite server-side whenever the dependent one is set.
export const CAPABILITIES = [
  {
    value: 'employs_people',
    label: 'Employs people',
    summary: 'Use this organisation as an employer of LearnScope learners.',
    enables: [
      'Role profiles section in the organisation workspace',
      'Branded sign-in and home page for its employees',
      'Listed as an employer that training providers can share courses with',
      'Courses it makes available are shown on its public organisation page',
    ],
    offWarning:
      'Turning this off hides Role profiles and the branded employee sign-in, and removes it from providers’ list of employers. Existing role profiles and assignments are kept, not deleted.',
  },
  {
    value: 'manages_workforce_development',
    label: 'Develops its workforce',
    summary: 'Marks the organisation as actively developing its employees’ skills.',
    enables: [],
    note: 'Doesn’t switch anything else on yet. Also turns on “Employs people”.',
    requires: 'employs_people',
  },
  {
    value: 'authors_learning',
    label: 'Authors learning',
    summary: 'Marks the organisation as creating its own training content.',
    enables: [],
    note: 'Doesn’t switch anything on or off yet — access to the training tabs comes from each person’s staff role in the organisation.',
  },
  {
    value: 'supplies_learning_externally',
    label: 'Supplies learning externally',
    summary: 'Marks the organisation as a training provider for other organisations.',
    enables: [],
    note: 'Doesn’t switch anything on yet — any organisation can share courses from its Distribution tab. Also turns on “Authors learning”.',
    requires: 'authors_learning',
  },
]

// Ticking a capability also ticks what it requires; unticking a prerequisite
// also unticks whatever depends on it -- otherwise the server would quietly
// re-add the prerequisite on save and the form wouldn't match the result.
export function toggleCapability(current, value, checked) {
  const next = new Set(current)
  if (checked) {
    next.add(value)
    const requires = CAPABILITIES.find((c) => c.value === value)?.requires
    if (requires) next.add(requires)
  } else {
    next.delete(value)
    CAPABILITIES.filter((c) => c.requires === value).forEach((c) => next.delete(c.value))
  }
  return CAPABILITIES.map((c) => c.value).filter((v) => next.has(v))
}
