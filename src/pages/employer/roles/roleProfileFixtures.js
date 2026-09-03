// Feature-local sample data for the employer-managed role profiles UI
// (RoleProfileList, RoleProfileDetailsForm, RoleProfileSkillsPanel,
// RoleProfileTrainingPanel, RoleProfileLinkedEmployeesPanel). Not imported
// by anything outside src/pages/employer/roles/.

export const FIXTURE_ROLE_PROFILES = [
  {
    id: 'role-profile-1',
    name: 'Senior Support Engineer',
    description: 'Handles escalated customer issues and mentors junior support staff.',
    updatedAt: '2026-08-15',
    requiredSkillCount: 3,
    trainingCount: 2,
    linkedEmployeeCount: 2,
  },
  {
    id: 'role-profile-2',
    name: 'Field Operations Lead',
    description: 'Coordinates on-site teams and owns operational reporting.',
    updatedAt: '2026-07-02',
    requiredSkillCount: 0,
    trainingCount: 0,
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

export const FIXTURE_REQUIRED_SKILLS = [
  { skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 },
  { skillId: 'skill-2', name: 'Stakeholder communication', targetLevel: 4 },
  { skillId: 'skill-4', name: 'Incident response', targetLevel: 3 },
]

// This employer's own course catalogue (see ProviderTrainingSection) --
// role-profile training only ever references an existing course by id,
// never duplicates its content.
export const FIXTURE_COURSE_CATALOGUE = [
  { id: 'course-1', title: 'De-escalation fundamentals' },
  { id: 'course-2', title: 'Advanced troubleshooting' },
  { id: 'course-3', title: 'Leading through change' },
]

export const FIXTURE_TRAINING = [
  { id: 'training-1', courseId: 'course-1', title: 'De-escalation fundamentals', requirement: 'required' },
  { id: 'training-2', courseId: 'course-2', title: 'Advanced troubleshooting', requirement: 'recommended' },
]

export const FIXTURE_LINKED_EMPLOYEES = [
  { id: 'employee-1', name: 'Priya Natarajan', email: 'priya@acme.example', linkedAt: '2026-06-01' },
  { id: 'employee-2', name: 'Owen McAllister', email: 'owen@acme.example', linkedAt: '2026-07-14' },
]
