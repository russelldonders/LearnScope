// Sort accessors and status labels for the employer People panel's tables
// (EmployerLearnersPanel and its assignment dialogs).

export const LEARNER_SORT_ACCESSORS = {
  id: (m) => m.userCode ?? '',
  email: (m) => (m.email || m.user_id || '').toLowerCase(),
  role: (m) => m.role ?? '',
  status: (m) => m.status ?? '',
}

export const ASSIGNMENT_SORT_ACCESSORS = {
  course: (a) => a.course_catalogue?.name?.toLowerCase() ?? '',
  learner: (a) => (a.learnerEmail || '').toLowerCase(),
  status: (a) => a.status ?? '',
  created_at: (a) => a.created_at ?? '',
}

export const ASSIGNMENT_STATUS_LABELS = {
  assigned: 'Assigned',
  enrolled: 'Started',
  dismissed: 'Dismissed',
}

export const SKILL_SUGGESTION_SORT_ACCESSORS = {
  skill: (s) => s.skill_name?.toLowerCase() ?? '',
  learner: (s) => (s.learnerEmail || '').toLowerCase(),
  status: (s) => s.status ?? '',
  created_at: (s) => s.created_at ?? '',
}

export const SKILL_SUGGESTION_STATUS_LABELS = {
  suggested: 'Suggested',
  adopted: 'Added by learner',
  dismissed: 'Dismissed',
}

export const DATA_ACCESS_STATUS_LABELS = {
  pending: 'Access requested',
  approved: 'Access granted',
  declined: 'Access declined',
  revoked: 'Access revoked',
}
