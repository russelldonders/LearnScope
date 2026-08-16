export const EXPERIENCE_TYPES = [
  { value: 'employment', label: 'Job' },
  { value: 'project', label: 'Project' },
  { value: 'course', label: 'Course / Training Record' },
  { value: 'volunteer', label: 'Volunteer Position' },
  { value: 'other', label: 'Other Experience' },
  { value: 'education', label: 'Education' },
]

export const EXPERIENCE_TYPE_LABELS = Object.fromEntries(EXPERIENCE_TYPES.map((t) => [t.value, t.label]))

// The types that can be added as a "sub-experience" nested under a Job or
// Volunteer Position -- e.g. a project or course record completed as part
// of that role. Automatically linked to the parent via parent_experience_id.
export const NESTED_EXPERIENCE_TYPES = ['project', 'course']

// Field copy and requiredness vary slightly per type -- a project or other
// personal pursuit doesn't always have an organization behind it, while a
// job or volunteer role expects one.
export const EXPERIENCE_TYPE_CONFIG = {
  employment: {
    modalTitle: 'Add job',
    titleLabel: 'Role title',
    orgLabel: 'Company',
    orgRequired: true,
    periodNoun: 'role',
  },
  project: {
    modalTitle: 'Add project',
    titleLabel: 'Project title',
    orgLabel: 'Organization (optional)',
    orgRequired: false,
    periodNoun: 'project',
  },
  volunteer: {
    modalTitle: 'Add volunteer position',
    titleLabel: 'Role title',
    orgLabel: 'Organization',
    orgRequired: true,
    periodNoun: 'role',
  },
  other: {
    modalTitle: 'Add other experience',
    titleLabel: 'Title',
    orgLabel: 'Organization (optional)',
    orgRequired: false,
    periodNoun: 'experience',
  },
  course: {
    modalTitle: 'Add course / training record',
    titleLabel: 'Course / training title',
    orgLabel: 'Provider (optional)',
    orgRequired: false,
    periodNoun: 'course',
  },
  education: {
    modalTitle: 'Add education',
    titleLabel: 'Degree / course title',
    orgLabel: 'Institution',
    orgRequired: true,
    periodNoun: 'study period',
  },
}
