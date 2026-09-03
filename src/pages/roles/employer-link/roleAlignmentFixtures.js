import { computeRoleAlignment } from './roleAlignment'

// Feature-local sample data for the learner-facing employer-role-assignment
// UI (CurrentRoleCard, PendingAssignmentsPanel, RoleAlignmentSummary). These
// are ONLY optional default prop values for an isolated/demo render of
// LearnerRoleAlignmentSection -- the component never substitutes this data
// back in after a real onAcceptAssignment/onDeclineAssignment/
// onDisconnectAssignment call; it only ever renders whatever
// pendingAssignments/linkedAssignments props it's actually given. Not
// imported by anything outside src/pages/roles/employer-link/.

// Sourced conceptually from the learner's own ongoing employment entries --
// see src/lib/currentRole.js's listCurrentRoleExperiences, which can return
// more than one -- shown here as flat view models rather than full
// experience records.
export const FIXTURE_CURRENT_ROLES = [
  { id: 'experience-1', title: 'Senior Support Engineer', organization: 'Acme Corp', since: '2024-03-01' },
]

// Only used to build this file's own FIXTURE_ALIGNMENT_BY_ASSIGNMENT_ID
// below (a one-time demo-default computation), never read by
// LearnerRoleAlignmentSection itself -- that component takes already-
// calculated alignment data as a prop, it doesn't compute it.
const FIXTURE_LEARNER_SKILLS = [
  { skillId: 'skill-1', name: 'Facilitation', level: 4 },
  { skillId: 'skill-2', name: 'Stakeholder communication', level: 2 },
  { skillId: 'skill-3', name: 'Data storytelling', level: 3 },
]

// An assignment an employer has proposed but the learner hasn't responded
// to yet -- accepting requires picking one of FIXTURE_CURRENT_ROLES (see
// PendingAssignmentsPanel), never fabricates a role of its own.
export const FIXTURE_PENDING_ASSIGNMENTS = [
  {
    assignmentId: 'assignment-2',
    employerName: 'Acme Corp',
    roleProfile: {
      id: 'role-profile-2',
      name: 'Field Operations Lead',
      description: 'Coordinates on-site teams and owns operational reporting.',
    },
    proposedAt: '2026-08-20',
  },
]

// "Incident response" (skill-4) is deliberately absent from
// FIXTURE_LEARNER_SKILLS above, so the fixtures demonstrate a real gap
// (skill not tracked at all) alongside a level-based gap ("Stakeholder
// communication") and a met requirement ("Facilitation") out of the box.
export const FIXTURE_LINKED_ASSIGNMENTS = [
  {
    assignmentId: 'assignment-1',
    employerName: 'Acme Corp',
    roleProfile: {
      id: 'role-profile-1',
      name: 'Senior Support Engineer',
      description: 'Handles escalated customer issues and mentors junior support staff.',
      requiredSkills: [
        { skillId: 'skill-1', name: 'Facilitation', targetLevel: 3 },
        { skillId: 'skill-2', name: 'Stakeholder communication', targetLevel: 4 },
        { skillId: 'skill-4', name: 'Incident response', targetLevel: 3 },
      ],
      training: [
        { courseId: 'course-1', title: 'De-escalation fundamentals', requirement: 'required' },
        { courseId: 'course-2', title: 'Advanced troubleshooting', requirement: 'recommended' },
      ],
    },
    linkedAt: '2026-07-01',
    currentRoleExperienceId: 'experience-1',
  },
]

// Pre-calculated alignment for the linked assignment above, keyed by
// assignmentId -- LearnerRoleAlignmentSection receives this shape directly
// as a prop in real use; it's computed here once, from the fixtures, purely
// as this file's own demo default.
export const FIXTURE_ALIGNMENT_BY_ASSIGNMENT_ID = {
  'assignment-1': computeRoleAlignment(FIXTURE_LEARNER_SKILLS, FIXTURE_LINKED_ASSIGNMENTS[0].roleProfile.requiredSkills),
}
