import AccessibleDialog from './AccessibleDialog'
import { formatAbsoluteDate } from '../lib/dates'

// Read-only "everything this employer holds about this person" view --
// membership (role/status/joined) plus every roster field value
// (20260911130000), in one place. Deliberately doesn't reach into the
// learner's actual LearnScope profile/skills/courses: that stays private
// unless they've explicitly granted this employer data access (surfaced
// below only as the consent status, same as the Users table's own Data
// access column), never pulled in wholesale the way AdminUserDetail.jsx
// does for a platform admin.
export default function EmployerMemberDetailModal({ member, fields, values, dataAccessLabel, dataAccessSummary, onClose, onEdit }) {
  return (
    <AccessibleDialog
      labelledBy="employer-member-detail-title"
      onClose={onClose}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="employer-member-detail-title" className="font-display text-xl text-ink mb-1">Member details</h2>
      <p className="text-sm text-secondary mb-4">{member.email || member.userCode || member.user_id}</p>

      <dl className="space-y-3 text-sm">
        <Row label="Role" value={member.role === 'admin' ? 'Admin' : member.role === 'member' ? 'Member' : '—'} />
        <Row
          label="Status"
          value={member.status === 'pending' ? 'Pending' : member.status === 'inactive' ? 'Inactive' : member.status === 'active' ? 'Active' : member.status || '—'}
        />
        <Row label="Added" value={member.created_at ? formatAbsoluteDate(member.created_at) : '—'} />
        <Row label="Data access" value={dataAccessLabel} detail={dataAccessSummary} />

        {fields.map((field) => (
          <Row key={field.id} label={field.label} value={values[field.id] || '—'} />
        ))}
      </dl>

      <div className="flex gap-2 pt-5">
        {onEdit && (
          <button type="button" onClick={onEdit} className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90">
            Edit details
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-md border border-hairline px-4 py-2 text-sm text-ink hover:bg-paper">
          Close
        </button>
      </div>
    </AccessibleDialog>
  )
}

function Row({ label, value, detail }) {
  return (
    <div>
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="text-ink">{value}</dd>
      {detail && <dd className="text-xs text-secondary mt-0.5">{detail}</dd>}
    </div>
  )
}
