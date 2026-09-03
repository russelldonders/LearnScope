import { useRef, useState } from 'react'
import PersonAvatar from '../../components/PersonAvatar'
import MutationFeedback from '../../components/MutationFeedback'
import AccessibleDialog from '../../components/AccessibleDialog'
import { SortableTh, TablePagination } from '../../components/TableControls'
import { useSortedPage } from '../../lib/useSortedPage'
import { LEVEL_LABELS } from '../../lib/levels'
import { formatRelativeDate, formatAbsoluteDate } from '../../lib/dates'

const SORT_ACCESSORS = {
  name: (m) => m.name?.toLowerCase() ?? '',
  teamSince: (m) => m.teamSince ?? '',
  sharedSkillCount: (m) => m.sharedSkills?.length ?? 0,
}

// Team roster is a projection over the manager's own connections (manager
// mode extends connections, it isn't a lightweight employer with its own
// member profiles). Deliberately narrow: each row shows only what a member
// has explicitly shared with this manager -- `sharedSkills` (with a level
// and evidence count, never the member's full skill list) and a count of
// team-scoped collaborative learning they're part of (see
// ManagerLearningPanel) -- never their complete learner profile. `members`,
// `loading`, `error` and `onInvite` are the only contract with the data
// layer; this component never fetches or writes anything itself.
export default function ManagerTeamPanel({ members = [], loading = false, error = null, onInvite }) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(members, SORT_ACCESSORS, { defaultSortKey: 'name' })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          People on your team, and the skills and evidence they've chosen to share with you. Inviting
          someone here doesn't grant access to their full profile -- only what they explicitly share.
        </p>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="shrink-0 rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
        >
          Invite to team
        </button>
      </div>

      <MutationFeedback status="error" message={error} />

      {loading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : members.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary text-sm">
            No team members yet. Invite one of your connections to build out your team.
          </p>
        </div>
      ) : (
        <div className="border border-hairline rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper border-b border-hairline text-left text-secondary">
                <tr>
                  <SortableTh label="Name" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh
                    label="Team since"
                    columnKey="teamSince"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="Shared skills"
                    columnKey="sharedSkillCount"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                  <th className="px-4 py-2 font-medium">Collaborative learning</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((member) => (
                  <tr key={member.id} className="border-b border-hairline last:border-b-0 align-top">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={7} />
                        <span className="text-ink">{member.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-secondary">
                      {member.teamSince ? (
                        <span title={formatAbsoluteDate(member.teamSince)}>
                          {formatRelativeDate(member.teamSince)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {member.sharedSkills?.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {member.sharedSkills.map((skill) => (
                            <span
                              key={skill.id}
                              title={`Shared ${formatAbsoluteDate(skill.sharedAt)}`}
                              className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-secondary border border-hairline rounded-full px-2 py-0.5"
                            >
                              {skill.name} · {LEVEL_LABELS[skill.level]}
                              {skill.evidenceCount > 0 && (
                                <span className="inline-flex items-center gap-0.5" aria-label={`${skill.evidenceCount} evidence item${skill.evidenceCount === 1 ? '' : 's'}`}>
                                  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" /></svg>
                                  {skill.evidenceCount}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-secondary">Nothing shared yet</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-secondary">
                      {member.collaborativeLearningCount ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={page}
            setPage={setPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            totalItems={totalItems}
            idPrefix="manager-team"
          />
        </div>
      )}

      {inviteOpen && (
        <InviteToTeamDialog
          onClose={() => setInviteOpen(false)}
          onInvite={onInvite}
        />
      )}
    </div>
  )
}

function InviteToTeamDialog({ onClose, onInvite }) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const initialFocusRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!onInvite) {
      onClose()
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onInvite(email.trim())
      onClose()
    } catch (error) {
      setSubmitError(error.message || 'Could not send the invitation. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      label="Invite to team"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-sm bg-card border border-hairline rounded-lg p-6"
    >
      <form onSubmit={handleSubmit}>
        <h2 className="font-display text-lg text-ink mb-1">Invite to team</h2>
        <p className="text-sm text-secondary mb-4">
          Invites go to an existing connection's email address. They'll need to accept before appearing
          on your team, and nothing of theirs becomes visible to you beyond what they choose to share.
        </p>
        <label htmlFor="manager-team-invite-email" className="block text-sm font-medium text-ink mb-1">
          Email
        </label>
        <input
          ref={initialFocusRef}
          id="manager-team-invite-email"
          type="email"
          required
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-dialog-initial-focus
          className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss mb-2"
        />
        <MutationFeedback status="error" message={submitError} className="mb-4" />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {submitting ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
