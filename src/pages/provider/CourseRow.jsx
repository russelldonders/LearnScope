import { Link } from 'react-router-dom'

// Summary only -- editing (metadata, sections, content) happens on the
// course's own page (ProviderCourseEditor), the same way AdminUserDetail/
// AdminSkillDetail moved their consoles' inline expansions onto dedicated
// pages once there was more than a form's worth of detail to show.
// canModerate mirrors AdminCatalogue.jsx's own approve/reject/deactivate/
// reactivate actions, just scoped here to a designated catalogue approver
// acting on their own organisation's submissions. A table row (mirroring
// AdminUsers.jsx's list) rather than the card grid this replaced -- a
// provider with more than a handful of courses could no longer scan
// name/code/status across many cards at once.
export default function CourseRow({
  course,
  columns,
  selected,
  onToggleSelected,
  canViewParticipants,
  onViewParticipants,
  onViewHistory,
  onEdit,
  creatingDraft,
  canModerate,
  actioning,
  rejecting,
  rejectionReason,
  onRejectionReasonChange,
  onStartReject,
  onCancelReject,
  onApprove,
  onReject,
  onDeactivate,
  readOnly,
  detailContext,
}) {
  const editable = course.status === 'draft' || course.status === 'rejected'
  const canStartEditing = !readOnly && (editable || course.status === 'approved')
  const columnCount = (readOnly ? 0 : 1) + columns.length + 1
  return (
    <>
      <tr className="border-b border-hairline last:border-0">
        {!readOnly && (
          <td className="px-4 py-3">
            <label className="sr-only" htmlFor={`select-course-${course.id}`}>Select {course.name}</label>
            <input
              id={`select-course-${course.id}`}
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              className="rounded border-hairline accent-moss"
            />
          </td>
        )}
        {columns.map((col) => (
          <td key={col.key} className={col.cellClassName}>
            {col.renderCell(course, detailContext)}
          </td>
        ))}
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-x-3 whitespace-nowrap">
            {canStartEditing ? (
              <button
                type="button"
                onClick={onEdit}
                disabled={creatingDraft}
                className="text-xs font-medium text-moss hover:underline disabled:cursor-wait disabled:opacity-60 whitespace-nowrap"
              >
                {creatingDraft ? 'Creating new version…' : course.status === 'rejected' ? 'Revise and resubmit' : 'Edit course'}
              </button>
            ) : (
              <Link to={`/organisation/training/${course.id}${detailContext ? `?${detailContext.slice(1)}` : ''}`} className="text-xs font-medium text-moss hover:underline whitespace-nowrap">
                View course
              </Link>
            )}
            <button type="button" onClick={onViewHistory} className="text-xs text-secondary hover:text-ink hover:underline whitespace-nowrap">
              Version history
            </button>
            {canViewParticipants && (
              <button type="button" onClick={onViewParticipants} className="text-xs text-secondary hover:text-ink hover:underline whitespace-nowrap">
                View participants
              </button>
            )}
            {canModerate && (course.status === 'pending_approval' || course.status === 'draft') && (
              <>
                <button
                  type="button"
                  disabled={actioning}
                  onClick={onApprove}
                  className="rounded-md bg-moss text-paper py-1 px-3 text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={actioning}
                  onClick={onStartReject}
                  className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
                >
                  Reject
                </button>
              </>
            )}
            {canModerate && course.status === 'approved' && (
              <button
                type="button"
                disabled={actioning}
                onClick={onDeactivate}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
              >
                Deactivate
              </button>
            )}
            {canModerate && (course.status === 'inactive' || course.status === 'rejected') && (
              <button
                type="button"
                disabled={actioning}
                onClick={onApprove}
                className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-50 whitespace-nowrap"
              >
                Reactivate (approve)
              </button>
            )}
          </div>
        </td>
      </tr>
      {rejecting && (
        <tr className="border-b border-hairline last:border-0">
          <td colSpan={columnCount} className="px-4 pb-3">
            <div className="flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-secondary mb-1" htmlFor={`reject-reason-${course.id}`}>Rejection reason (required)</label>
                <input
                  id={`reject-reason-${course.id}`}
                  required
                  aria-required="true"
                  value={rejectionReason}
                  onChange={(e) => onRejectionReasonChange(e.target.value)}
                  className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
              </div>
              <button
                type="button"
                onClick={onReject}
                disabled={actioning || !rejectionReason.trim()}
                className="rounded-md bg-red-700 text-white py-1.5 px-3 text-sm font-medium hover:bg-red-800 disabled:opacity-50"
              >
                Confirm reject
              </button>
              <button type="button" onClick={onCancelReject} className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm hover:bg-paper">
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
