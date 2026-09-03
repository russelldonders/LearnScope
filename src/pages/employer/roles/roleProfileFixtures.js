// Feature-local sample data for the employer-managed role profiles UI.
// These are ONLY optional default prop values for an isolated/demo render
// of EmployerRoleProfilesConsole and its leaf panels -- the console never
// substitutes this data back in after a real onSelectRoleProfile/
// onSaveRoleProfile/onReplaceSkills/onReplaceTraining/onAssignEmployee/
// onWithdrawAssignment call; it only ever renders whatever roleProfiles/
// linkedEmployees props it's actually given. Not imported by anything
// outside src/pages/employer/roles/.

// Training entries are keyed by courseId (a role profile can only assign a
// given course once), not a separate synthetic id -- there's no id to
// mint client-side for something that doesn't exist until a real save.
export const FIXTURE_ROLE_PROFILES = [
  {
    id: 'role-profile-1',
    name: 'Senior Support Engineer',
    description: 'Handles escalated customer issues and mentors junior support staff.',
    updatedAt: '2026-08-15',
    requiredSkills: [
      { skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 },
      { skillId: 'skill-2', name: 'Stakeholder communication', targetLevel: 4 },
      { skillId: 'skill-4', name: 'Incident response', targetLevel: 3 },
    ],
    training: [
      { courseId: 'course-1', title: 'De-escalation fundamentals', requirement: 'required' },
      { courseId: 'course-2', title: 'Advanced troubleshooting', requirement: 'recommended' },
    ],
    linkedEmployeeCount: 2,
  },
  {
    id: 'role-profile-2',
    name: 'Field Operations Lead',
    description: 'Coordinates on-site teams and owns operational reporting.',
    updatedAt: '2026-07-02',
    requiredSkills: [],
    training: [],
    linkedEmployeeCount: 0,
  },
]

// Every skill this employer's learners could plausibly have -- the picker
// in RoleProfileSkillsPanel offers only the ones not already required.
export const FIXTURE_SKILL_CATALOGUE = [
  { id: 'skill-1', name: 'Facilitation' },
  { id: 'skill-2', name: 'Stakeholder communication' },
  { id: 'skill-3', name: 'Data storytelling' },
  { id: 'skill-4', name: 'Incident response' },
]

// This employer's own course catalogue (see ProviderTrainingSection) --
// role-profile training only ever references an existing course by id,
// never duplicates its content.
export const FIXTURE_COURSE_CATALOGUE = [
  { id: 'course-1', title: 'De-escalation fundamentals' },
  { id: 'course-2', title: 'Advanced troubleshooting' },
  { id: 'course-3', title: 'Leading through change' },
]

// Assignment status: 'pending' (proposed, awaiting the employee's own
// accept/decline -- see src/pages/roles/employer-link/) or 'accepted'
// (the employee linked it to one of their own current-role records).
export const FIXTURE_LINKED_EMPLOYEES = [
  { assignmentId: 'assignment-1', name: 'Priya Natarajan', email: 'priya@acme.example', status: 'accepted', assignedAt: '2026-06-01' },
  { assignmentId: 'assignment-2', name: 'Owen McAllister', email: 'owen@acme.example', status: 'pending', assignedAt: '2026-07-14' },
]
