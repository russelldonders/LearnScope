import MutationFeedback from '../../../components/MutationFeedback'
import CurrentRoleCard from './CurrentRoleCard'
import PendingAssignmentsPanel from './PendingAssignmentsPanel'
import RoleAlignmentSummary from './RoleAlignmentSummary'
import {
  FIXTURE_ALIGNMENT_BY_ASSIGNMENT_ID,
  FIXTURE_CURRENT_ROLES,
  FIXTURE_LINKED_ASSIGNMENTS,
  FIXTURE_PENDING_ASSIGNMENTS,
} from './roleAlignmentFixtures'

// Genuinely props-in/callbacks-out: this composes the learner-facing pieces
// above but owns no business data of its own -- no current role, pending
// assignment, linked assignment or alignment result ever lives in local
// state here. Accepting, declining or disconnecting an assignment is only
// ever relayed upward as a callback; the UI only reflects what comes back
// down through `pendingAssignments`/`linkedAssignments` on the next render.
// The learner can never fabricate a role-profile link this way -- only
// respond to what an employer has already proposed (see
// src/pages/employer/roles/RoleProfileLinkedEmployeesPanel).
//
// The FIXTURE_* imports are optional default prop values for an isolated
// render only -- they are never substituted back in after a real callback
// fires, and a caller that wires real data is expected to override every
// prop, including `alignmentByAssignmentId` (already-calculated aligned/
// gaps data; this component does not compute alignment itself).
export default function LearnerRoleAlignmentSection({
  currentRoles = FIXTURE_CURRENT_ROLES,
  pendingAssignments = FIXTURE_PENDING_ASSIGNMENTS,
  linkedAssignments = FIXTURE_LINKED_ASSIGNMENTS,
  alignmentByAssignmentId = FIXTURE_ALIGNMENT_BY_ASSIGNMENT_ID,
  linking = false,
  disconnecting = false,
  error = null,
  onAcceptAssignment,
  onDeclineAssignment,
  onDisconnectAssignment,
}) {
  return (
    <div className="space-y-6">
      <CurrentRoleCard currentRoles={currentRoles} />

      {/* One shared banner for whichever action last failed -- `error` has
          no assignmentId of its own, so passing it into every linked
          assignment's own alert (there can be more than one) or every
          pending assignment's card would misattribute it. */}
      <MutationFeedback status="error" message={error} />

      {linkedAssignments.map((assignment) => {
        const { aligned = [], gaps = [] } = alignmentByAssignmentId[assignment.assignmentId] ?? {}
        return (
          <RoleAlignmentSummary
            key={assignment.assignmentId}
            assignment={assignment}
            aligned={aligned}
            gaps={gaps}
            training={assignment.roleProfile.training}
            disconnecting={disconnecting}
            onDisconnect={() => onDisconnectAssignment?.(assignment.assignmentId)}
          />
        )
      })}

      <PendingAssignmentsPanel
        pendingAssignments={pendingAssignments}
        currentRoles={currentRoles}
        responding={linking}
        onAcceptAssignment={onAcceptAssignment}
        onDeclineAssignment={onDeclineAssignment}
      />
    </div>
  )
}
