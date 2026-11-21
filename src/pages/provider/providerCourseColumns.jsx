import { Link } from 'react-router-dom'
import StatusBadge from '../../components/StatusBadge'
import { COURSE_STATUS_LABELS } from '../../lib/statusLabels'

const COURSE_STATUS_TONES = {
  approved: 'success',
  pending_approval: 'warning',
  rejected: 'danger',
  draft: 'neutral',
  inactive: 'neutral',
}

// Customizable data columns only -- the leading selection checkbox and the
// trailing actions column (Edit/View history/participants/Approve/Reject/
// Deactivate) stay pinned outside this list, exactly like AdminEmployers.jsx
// pins its own "Add admin" actions column. No external dependency needed
// (unlike AdminEmployers.jsx's organisationById), so this is a plain
// constant rather than a factory function.
export const COURSE_COLUMNS = [
  {
    key: 'course_code',
    label: 'ID',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 font-mono text-xs text-secondary whitespace-nowrap',
    renderCell: (course) => course.course_code || 'Not set',
  },
  {
    key: 'name',
    label: 'Training',
    sortable: true,
    cellClassName: 'px-4 py-3 whitespace-nowrap',
    renderCell: (course, detailContext = '') => (
      <Link to={`/organisation/training/${course.id}${detailContext ? `?${detailContext.slice(1)}` : ''}`} className="text-ink font-medium hover:text-moss hover:underline">
        {course.name}
      </Link>
    ),
  },
  {
    key: 'version',
    label: 'Version',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 whitespace-nowrap',
    renderCell: (course) => (
      <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">{course.version_number}</span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    thClassName: 'whitespace-nowrap',
    cellClassName: 'px-4 py-3 whitespace-nowrap',
    renderCell: (course) => (
      <StatusBadge label={COURSE_STATUS_LABELS[course.status] ?? course.status} tone={COURSE_STATUS_TONES[course.status] ?? 'neutral'} />
    ),
  },
  {
    key: 'rejection_reason',
    label: 'Rejection reason',
    sortable: true,
    cellClassName: 'px-4 py-3 text-red-700 truncate max-w-[180px]',
    renderCell: (course) => course.rejection_reason || '—',
  },
  {
    key: 'synopsis',
    label: 'Synopsis',
    sortable: true,
    cellClassName: 'px-4 py-3 text-secondary truncate max-w-xs',
    renderCell: (course) => course.synopsis || '—',
  },
]
