// Feature-local sample data for the transfer-plan review UI (PlanAccountsSummary,
// PlanCategoryBreakdown, PlanConflictResolutionList, PlanApprovalPanel,
// TransferPlanReviewPanel). Optional default prop values for an isolated/demo
// render only -- not imported by anything outside
// src/pages/account-linking/transfer-plan/, and never substituted back in
// after a real callback fires.

export const FIXTURE_DURABLE_ACCOUNT = {
  id: 'account-1',
  email: 'me.personal@example.com',
  accountType: 'Personal account',
}

export const FIXTURE_SOURCE_ACCOUNT = {
  id: 'account-2',
  email: 'me.work@example.com',
  accountType: 'Employer-verified account',
}

// Viewing as the durable account's owner by default -- tests/fixtures for
// the source account's perspective pass FIXTURE_SOURCE_ACCOUNT.id instead.
export const FIXTURE_CURRENT_ACCOUNT_ID = FIXTURE_DURABLE_ACCOUNT.id

// A null count means that category couldn't be loaded (partial data), not
// that it's confirmed zero -- same convention as ../transfer/.
export const FIXTURE_CATEGORIES = [
  { key: 'skills', label: 'Skills', sourceCount: 11, durableCount: 18 },
  { key: 'experience', label: 'Experience', sourceCount: 2, durableCount: 4 },
  { key: 'courses', label: 'Courses & training', sourceCount: 3, durableCount: 6 },
  { key: 'evidence', label: 'Evidence', sourceCount: 5, durableCount: 12 },
  { key: 'connections', label: 'Connections', sourceCount: 0, durableCount: 9 },
  { key: 'integrations', label: 'External integrations', sourceCount: null, durableCount: 1 },
]

// `resolution: null` means unresolved. `options` are supplied by the
// caller so exact wording (including the level/date/etc named in the
// label) can come from real data -- this component never generates option
// text itself.
export const FIXTURE_CONFLICTS_UNRESOLVED = [
  {
    id: 'conflict-1',
    category: 'skills',
    description: '"Facilitation" is tracked on both accounts at different levels.',
    options: [
      { value: 'keep_durable', label: "Keep the durable account's level (Skilled)" },
      { value: 'keep_source', label: "Keep the source account's level (Capable)" },
      { value: 'keep_both', label: 'Keep both as separate skill entries' },
    ],
    resolution: null,
  },
  {
    id: 'conflict-2',
    category: 'courses',
    description: '"De-escalation fundamentals" appears on both accounts.',
    options: [
      { value: 'keep_durable', label: "Keep only the durable account's record" },
      { value: 'keep_source', label: "Keep only the source account's record" },
      { value: 'keep_both', label: 'Keep both records' },
    ],
    resolution: null,
  },
  {
    id: 'conflict-3',
    category: 'experience',
    description: '"Senior Support Engineer" at Acme Corp may be the same as "Support Engineer" at Acme Corp.',
    options: [
      { value: 'keep_durable', label: "Keep the durable account's entry" },
      { value: 'keep_source', label: "Keep the source account's entry" },
      { value: 'keep_both', label: 'Keep both entries' },
    ],
    resolution: null,
  },
]

export const FIXTURE_CONFLICTS_RESOLVED = FIXTURE_CONFLICTS_UNRESOLVED.map((c) => ({
  ...c,
  resolution: 'keep_durable',
}))

export const FIXTURE_PLAN_PENDING = {
  id: 'plan-1',
  version: 1,
  status: 'pending',
  createdAt: '2026-09-01T10:00:00Z',
  expiresAt: '2026-09-15T10:00:00Z',
  sourceAccount: FIXTURE_SOURCE_ACCOUNT,
  durableAccount: FIXTURE_DURABLE_ACCOUNT,
  categories: FIXTURE_CATEGORIES,
  conflicts: FIXTURE_CONFLICTS_UNRESOLVED,
  approvals: [],
}

// All conflicts resolved and the durable account has approved this exact
// version -- demonstrates "waiting on the other account" (and the current
// viewer's own controls locking once their approval is on file).
export const FIXTURE_PLAN_PARTIALLY_APPROVED = {
  ...FIXTURE_PLAN_PENDING,
  version: 2,
  conflicts: FIXTURE_CONFLICTS_RESOLVED,
  approvals: [{ accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 }],
}

export const FIXTURE_PLAN_APPROVED = {
  ...FIXTURE_PLAN_PARTIALLY_APPROVED,
  status: 'approved',
  approvals: [
    { accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-02T09:00:00Z', approvedVersion: 2 },
    { accountId: FIXTURE_SOURCE_ACCOUNT.id, approvedAt: '2026-09-03T14:00:00Z', approvedVersion: 2 },
  ],
}

// The durable account approved version 2, but the plan has since moved to
// version 3 (e.g. a conflict resolution changed) -- that approval no
// longer counts, and the UI must say so rather than silently treating it
// as still valid.
export const FIXTURE_PLAN_STALE_APPROVAL = {
  ...FIXTURE_PLAN_PENDING,
  version: 3,
  conflicts: FIXTURE_CONFLICTS_RESOLVED,
  approvals: [{ accountId: FIXTURE_DURABLE_ACCOUNT.id, approvedAt: '2026-09-01T09:00:00Z', approvedVersion: 2 }],
}

export const FIXTURE_PLAN_EXECUTED = { ...FIXTURE_PLAN_APPROVED, status: 'executed' }
export const FIXTURE_PLAN_CANCELLED = { ...FIXTURE_PLAN_PENDING, status: 'cancelled' }
export const FIXTURE_PLAN_EXPIRED = { ...FIXTURE_PLAN_PENDING, status: 'expired' }
