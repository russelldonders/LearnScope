// Feature-local sample data for the learner-facing employer-role-profile
// link/alignment UI (CurrentRoleCard, RoleProfileLinkPicker,
// RoleAlignmentSummary). Not imported by anything outside
// src/pages/roles/employer-link/.

// Sourced conceptually from the learner's own current (ongoing) employment
// entry -- see src/lib/currentRole.js -- shown here as a flat view model
// rather than a full experience record.
export const FIXTURE_CURRENT_ROLE = {
  title: 'Senior Support Engineer',
  organization: 'Acme Corp',
  since: '2024-03-01',
}

export const FIXTURE_LEARNER_SKILLS = [
  { skillId: 'skill-1', name: 'Facilitation', level: 4 },
  { skillId: 'skill-2', name: 'Stakeholder communication', level: 2 },
  { skillId: 'skill-3', name: 'Data storytelling', level: 3 },
]

export const FIXTURE_LINKABLE_ROLE_PROFILES = [
  {
    id: 'role-profile-1',
    employerName: 'Acme Corp',
    name: 'Senior Support Engineer',
    description: 'Handles escalated customer issues and mentors junior support staff.',
    requiredSkillCount: 3,
    trainingCount: 2,
  },
  {
    id: 'role-profile-2',
    employerName: 'Acme Corp',
    name: 'Field Operations Lead',
    description: 'Coordinates on-site teams and owns operational reporting.',
    requiredSkillCount: 0,
    trainingCount: 0,
  },
]

// "Incident response" (skill-4) is deliberately absent from
// FIXTURE_LEARNER_SKILLS above, so the fixtures demonstrate a real gap
// (skill not tracked at all) alongside a level-based gap ("Stakeholder
// communication") and a met requirement ("Facilitation") out of the box.
export const FIXTURE_LINKED_ROLE_PROFILE = {
  id: 'role-profile-1',
  employerName: 'Acme Corp',
  name: 'Senior Support Engineer',
  description: 'Handles escalated customer issues and mentors junior support staff.',
  linkedAt: '2026-07-01',
  requiredSkills: [
    { skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 },
    { skillId: 'skill-2', name: 'Stakeholder communication', targetLevel: 4 },
    { skillId: 'skill-4', name: 'Incident response', targetLevel: 3 },
  ],
  training: [
    { id: 'training-1', title: 'De-escalation fundamentals', requirement: 'required' },
    { id: 'training-2', title: 'Advanced troubleshooting', requirement: 'recommended' },
  ],
}
