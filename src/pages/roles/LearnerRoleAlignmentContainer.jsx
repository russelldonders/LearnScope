import { useMyRoleAssignments } from './useMyRoleAssignments'
import LearnerRoleAlignmentSection from './employer-link/LearnerRoleAlignmentSection'

// employerId optionally scopes this down to one employer's own assignments
// (EmployerHome.jsx, reached via that employer's own URL) instead of every
// employer the learner has ever connected a role to (Experience.jsx used to
// use this without it too, showing every one of them here -- that's now
// integrated directly into the timeline instead, see ExperienceSection.jsx
// and useMyRoleAssignments' own comment).
export default function LearnerRoleAlignmentContainer({ employerId } = {}) {
  const {
    currentRoles, pendingAssignments, linkedAssignments, alignmentByAssignmentId,
    loading, error, acceptAssignment, declineAssignment, disconnectAssignment,
  } = useMyRoleAssignments(employerId)

  return (
    <section aria-labelledby="role-alignment-heading">
      <div className="mb-6">
        <p className="text-xs font-medium text-secondary uppercase tracking-wide">Work alignment</p>
        <h2 id="role-alignment-heading" className="font-display text-2xl text-ink mt-1">Role profile connections</h2>
        <p className="text-sm text-secondary mt-2 max-w-2xl">
          Connect an employer's requirements to a current role you control. Your employer cannot edit your personal role, skills, or learning history.
        </p>
      </div>
      <LearnerRoleAlignmentSection
        currentRoles={currentRoles}
        pendingAssignments={pendingAssignments}
        linkedAssignments={linkedAssignments}
        alignmentByAssignmentId={alignmentByAssignmentId}
        linking={loading}
        disconnecting={loading}
        error={error}
        onAcceptAssignment={acceptAssignment}
        onDeclineAssignment={declineAssignment}
        onDisconnectAssignment={disconnectAssignment}
      />
    </section>
  )
}
