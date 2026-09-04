// Feature-local sample data for LinkedWorkspaceAccessPanel. Optional default
// prop values for an isolated/demo render only -- see accountLinkingFixtures.js's
// top-of-file note, which applies here too.

export const FIXTURE_WORKSPACE_ACCESS_REQUESTS = [
  { id: 'request-1', linkId: 'link-2', email: 'me.work@example.com', direction: 'received', status: 'pending', createdAt: '2026-09-01T10:00:00Z' },
]

export const FIXTURE_WORKSPACE_ACCESS_GRANTS = [
  { linkId: 'link-1', email: 'me.personal@example.com', direction: 'received', grantedAt: '2026-08-20T10:00:00Z' },
]
