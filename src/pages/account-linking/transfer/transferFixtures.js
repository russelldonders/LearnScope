// Feature-local sample data for the profile-transfer preview UI
// (AccountProfileSummaryCard, TransferConflictsSummary, TransferPreviewPanel).
// Optional default prop values for an isolated/demo render only -- not
// imported by anything outside src/pages/account-linking/transfer/, and
// never substituted back in after a real callback fires.

// A null count means that category couldn't be loaded for this account
// (see `countsError`), not that it's confirmed zero -- the card renders
// those two cases differently.
export const FIXTURE_ACCOUNT_A = {
  id: 'account-1',
  email: 'me.personal@example.com',
  accountType: 'Personal account',
  counts: { skills: 18, experience: 4, courses: 6, evidence: 12, connections: 9, integrations: 1 },
  countsError: null,
}

export const FIXTURE_ACCOUNT_B = {
  id: 'account-2',
  email: 'me.work@example.com',
  accountType: 'Employer-verified account',
  counts: { skills: 11, experience: 2, courses: 3, evidence: 5, connections: 0, integrations: null },
  countsError: "Some of this account's counts (external integrations) could not be loaded.",
}

export const FIXTURE_CONFLICTS = {
  duplicateSkills: [
    { name: 'Facilitation', levelA: 4, levelB: 3 },
    { name: 'Stakeholder communication', levelA: 2, levelB: 4 },
  ],
  overlappingCourses: [{ title: 'De-escalation fundamentals' }],
  possibleDuplicateExperience: [
    {
      titleA: 'Senior Support Engineer',
      organizationA: 'Acme Corp',
      titleB: 'Support Engineer',
      organizationB: 'Acme Corp',
    },
  ],
}

export const FIXTURE_TRANSFER_PREVIEW = {
  accountA: FIXTURE_ACCOUNT_A,
  accountB: FIXTURE_ACCOUNT_B,
  conflicts: FIXTURE_CONFLICTS,
}

export const FIXTURE_NO_CONFLICTS = {
  duplicateSkills: [],
  overlappingCourses: [],
  possibleDuplicateExperience: [],
}
