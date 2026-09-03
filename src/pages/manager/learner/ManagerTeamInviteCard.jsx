import { formatRelativeDate, formatAbsoluteDate } from '../../../lib/dates'

// Learner-facing invite card for a manager's team, same card/Accept-Decline
// shape as Actions.jsx's provider/employer invite cards -- but unlike those,
// accepting a manager-team invite never grants the manager anything beyond
// what the learner later chooses to share (see ManagerTeamSharingPanel), so
// the copy below says so explicitly rather than assuming that's understood.
// Props-in/callbacks-out only: `invite` is { id, teamName, managerName,
// invitedAt }; `submitting` disables both actions while a response is in
// flight; `error` renders inline if the last response failed; `onAccept`/
// `onDecline` are called with no arguments (the id is already in `invite`).
export default function ManagerTeamInviteCard({ invite, submitting = false, error = null, onAccept, onDecline }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-4">
      <p className="text-sm text-ink">
        <strong>{invite.managerName}</strong> invited you to join their team, <strong>{invite.teamName}</strong>
      </p>
      <p className="font-mono text-xs text-secondary mt-1" title={formatAbsoluteDate(invite.invitedAt)}>
        {formatRelativeDate(invite.invitedAt)}
      </p>
      <p className="text-sm text-secondary mt-2">
        Joining lets you collaborate with this team -- it does not give {invite.managerName} access to your
        complete profile. They'll only ever see the specific skills and evidence you choose to share, and any
        learning you do together as a team. You can leave the team at any time.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-700 mt-2">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => onAccept?.()}
          disabled={submitting}
          className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onDecline?.()}
          disabled={submitting}
          className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
