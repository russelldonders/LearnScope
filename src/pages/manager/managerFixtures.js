// Feature-local sample data for the independent-manager console. Shapes
// here are the view models ManagerConsole.jsx's panels expect -- the
// eventual src/lib/managerTeams.js service returns the same shapes, this
// file just stands in for it until that service exists. Not imported by
// anything outside src/pages/manager/.
//
// Deliberately excludes anything resembling a member's complete learner
// profile: TeamMember only carries skills/evidence the member has
// explicitly shared, plus a count of team-scoped collaborative learning
// they're part of -- never their full skill list, experience, or personal
// course history.

export const FIXTURE_TEAM = [
  {
    id: 'fixture-member-1',
    name: 'Priya Nair',
    avatarUrl: null,
    teamSince: '2026-04-12',
    sharedSkills: [
      { id: 'skill-1', name: 'Facilitation', level: 4, sharedAt: '2026-06-01', evidenceCount: 1 },
      { id: 'skill-2', name: 'Stakeholder communication', level: 3, sharedAt: '2026-07-10', evidenceCount: 0 },
    ],
    collaborativeLearningCount: 2,
  },
  {
    id: 'fixture-member-2',
    name: 'Owen Marsh',
    avatarUrl: null,
    teamSince: '2026-05-20',
    sharedSkills: [
      { id: 'skill-3', name: 'Data storytelling', level: 2, sharedAt: '2026-08-02', evidenceCount: 2 },
    ],
    collaborativeLearningCount: 1,
  },
]

export const FIXTURE_LEARNING = [
  {
    id: 'fixture-learning-1',
    title: 'Q3 facilitation cohort',
    kind: 'course',
    status: 'in_progress',
    memberIds: ['fixture-member-1'],
    memberNames: ['Priya Nair'],
    occurredAt: '2026-08-15',
  },
  {
    id: 'fixture-learning-2',
    title: 'Cross-team retro workshop',
    kind: 'session',
    status: 'completed',
    memberIds: ['fixture-member-1', 'fixture-member-2'],
    memberNames: ['Priya Nair', 'Owen Marsh'],
    occurredAt: '2026-07-22',
  },
]

export const FIXTURE_RECORDS = [
  {
    id: 'fixture-record-1',
    title: 'Growth conversation follow-up',
    note: 'Agreed next step: pair Priya with Owen on the retro workshop debrief.',
    memberIds: ['fixture-member-1'],
    memberNames: ['Priya Nair'],
    createdAt: '2026-08-20',
  },
]

export const FIXTURE_PENDING_INVITES = [
  { id: 'fixture-invite-1', email: 'jordan@example.com', sentAt: '2026-08-25' },
]
