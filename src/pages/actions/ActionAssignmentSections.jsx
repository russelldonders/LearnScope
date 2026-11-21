import { useLanguage } from '../../context/LanguageContext'
import AssignedPlansList from '../../components/AssignedPlansList'
import { listMyPlanAssignments } from '../../lib/organisationPlans'
import { requestedDataSummary } from '../../lib/employerDataAccess'

// An employer asking to see some of the learner's data.
export function DataAccessRequestsSection({
  dataAccessDecidingId,
  dataAccessError,
  dataAccessRequests,
  handleDataAccessDecline,
  handleOpenAcceptDataAccess,
}) {
  const { t } = useLanguage()

  return (
    <div id="data-access-requests">
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.dataAccessRequests')}</h2>
      <div className="space-y-3">
        {dataAccessRequests.map((request) => (
          <div key={request.id} className="bg-card border border-hairline rounded-lg p-4">
            <p className="text-sm text-ink">
              <strong>{request.employers?.name || 'An employer'}</strong> would like access to: {' '}
              {requestedDataSummary(request)}
            </p>
            <p className="font-mono text-xs text-secondary mt-1">
              {new Date(request.created_at).toLocaleDateString()}
            </p>
            {request.request_comment && <blockquote className="text-sm text-secondary whitespace-pre-wrap mt-2">{request.request_comment}</blockquote>}
            {dataAccessError?.id === request.id && (
              <p className="text-xs text-red-700 mt-1">{dataAccessError.message}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => handleOpenAcceptDataAccess(request)}
                disabled={dataAccessDecidingId === request.id}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                Review request
              </button>
              <button
                type="button"
                onClick={() => handleDataAccessDecline(request.id)}
                disabled={dataAccessDecidingId === request.id}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Courses an employer assigned; starting one is the learner's choice.
export function AssignedTrainingSection({
  assignmentActingId,
  assignmentError,
  courseAssignments,
  handleAssignmentResponse,
}) {
  const { t } = useLanguage()

  return (
    <div id="assigned-training">
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.assignedTraining')}</h2>
      <div className="space-y-3">
        {courseAssignments.map((assignment) => (
          <div key={assignment.id} className="bg-card border border-hairline rounded-lg p-4">
            <p className="text-sm text-ink">
              <strong>{assignment.employers?.name || 'An employer'}</strong> assigned you a course:{' '}
              <strong>{assignment.course_catalogue?.name}</strong>
            </p>
            <p className="font-mono text-xs text-secondary mt-1">
              {new Date(assignment.created_at).toLocaleDateString()}
            </p>
            {assignmentError?.id === assignment.id && (
              <p className="text-xs text-red-700 mt-1">{assignmentError.message}</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={() => handleAssignmentResponse(assignment, true)}
                disabled={assignmentActingId === assignment.id}
                className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
              >
                Start
              </button>
              <button
                type="button"
                onClick={() => handleAssignmentResponse(assignment, false)}
                disabled={assignmentActingId === assignment.id}
                className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Plans an organisation assigned.
export function AssignedPlansSection({
  planAssignments,
  setPlanAssignments,
}) {
  const { t } = useLanguage()

  return (
    <div id="assigned-plans">
      <h2 className="font-display text-xl text-ink mb-6">{t('actions.assignedPlans')}</h2>
      <div className="bg-card border border-hairline rounded-lg p-4">
        <AssignedPlansList
          assignments={planAssignments}
          onChanged={() => listMyPlanAssignments()
            .then((rows) => setPlanAssignments(rows.filter((a) => a.status === 'assigned')))
            .catch(() => {})}
        />
      </div>
    </div>
  )
}
