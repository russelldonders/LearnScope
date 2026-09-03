// Feature-local sample data for the learner-facing manager-team consent
// components (ManagerTeamInviteCard, ManagerTeamSharingPanel). Not imported
// by anything outside src/pages/manager/learner/.

export const FIXTURE_INVITE = {
  id: 'fixture-invite-1',
  teamName: 'Field Ops Growth Team',
  managerName: 'Dana Whitfield',
  invitedAt: '2026-08-28',
}

export const FIXTURE_MEMBERSHIP = {
  id: 'fixture-membership-1',
  teamName: 'Field Ops Growth Team',
  managerName: 'Dana Whitfield',
  joinedAt: '2026-06-15',
}

export const FIXTURE_AVAILABLE_SKILLS = [
  { id: 'skill-1', name: 'Facilitation', level: 4, evidenceCount: 1 },
  { id: 'skill-2', name: 'Stakeholder communication', level: 3, evidenceCount: 0 },
  { id: 'skill-3', name: 'Data storytelling', level: 2, evidenceCount: 2 },
]

export const FIXTURE_SHARED_SKILL_IDS = ['skill-1']
