import { useEffect, useState } from 'react'
import PersonAvatar from '../../components/PersonAvatar'
import MutationFeedback from '../../components/MutationFeedback'
import AccessibleDialog from '../../components/AccessibleDialog'
import EvidenceFields from '../../components/EvidenceFields'
import { SortableTh, TablePagination } from '../../components/TableControls'
import { useSortedPage } from '../../lib/useSortedPage'
import { LEVELS, LEVEL_LABELS } from '../../lib/levels'
import { formatRelativeDate, formatAbsoluteDate } from '../../lib/dates'
import ManagerMemberProfile from './ManagerMemberProfile'

const SORT_ACCESSORS = {
  name: (m) => m.name?.toLowerCase() ?? '',
  teamSince: (m) => m.teamSince ?? '',
  sharedSkillCount: (m) => m.sharedSkills?.length ?? 0,
}

const inviteButtonClass = 'shrink-0 rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper'

// Team roster is a projection over the manager's own connections (manager
// mode extends connections, it isn't a lightweight employer with its own
// member profiles). Deliberately narrow: each row shows only what a member
// has explicitly shared with this manager -- a count of `sharedSkills` (and
// how many of those this manager has rated), never the member's full skill
// list -- and a count of team-scoped collaborative learning they're part of
// (see ManagerLearningPanel), never their complete learner profile.
//
// This tab is about *people* -- who's on the team, who's still to accept,
// inviting more. Rating a shared skill happens from the Skills matrix or a
// member's own profile (ManagerMemberProfile, opened from the name here),
// not from per-skill chips in this table, which grew unreadably wide once a
// few members had shared a handful of skills each. RateSkillDialog below is
// still exported for that profile view.
// `members`, `loading`, `error`, `onInvite`, `onInviteConnections`,
// `onRateSkill` and `onLoadSkillAssessments` are the only contract with the
// data layer; this component never fetches or writes anything itself
// outside of those.
export default function ManagerTeamPanel({
  members = [], pendingMembers = [], loading = false, error = null, onInvite, onInviteConnections,
  onRevokeInvite, connections = [], teamMemberships = [], onOpenCollaboration,
  onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget, readOnly = false,
}) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [profileId, setProfileId] = useState(null)
  const profileMember = members.find((member) => member.id === profileId)
  // Invited-but-not-yet-accepted people stay in the same table (they're
  // genuinely "in the list"), but pinned above the sorted/paged members
  // with an explicit "Invited" badge rather than blending in wherever the
  // current sort happens to put them.
  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(members, SORT_ACCESSORS, { defaultSortKey: 'name' })
  const hasRows = members.length > 0 || pendingMembers.length > 0

  if (profileMember) return <ManagerMemberProfile member={profileMember} onBack={() => setProfileId(null)}
    onRateSkill={onRateSkill} onLoadSkillAssessments={onLoadSkillAssessments}
    onLoadSkillDetail={onLoadSkillDetail} onSetTarget={onSetTarget} />

  const inviteButton = !readOnly && (
    <button type="button" onClick={() => setInviteOpen(true)} className={inviteButtonClass}>
      Invite to team
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          Open a team member’s skills profile to review their progress, rate a skill or set a target.
          Profiles show only the skills they’ve shared with you.
        </p>
        {hasRows && inviteButton}
      </div>

      <MutationFeedback status="error" message={error} />

      {loading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : !hasRows ? (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg space-y-3">
          <p className="text-secondary text-sm">
            No team members yet. Invite your connections, or anyone by email, to build out your team.
          </p>
          {inviteButton}
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
                {page === 1 && pendingMembers.map((member) => (
                  <tr key={member.id} className="border-b border-hairline last:border-b-0 align-top bg-paper/60">
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={7} />
                        <span className="text-ink">{member.name}</span>
                        <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-ink">
                          Invited
                        </span>
                      </div>
                      {onRevokeInvite && (
                        <button type="button" onClick={() => onRevokeInvite(member)}
                          className="mt-2 text-sm font-medium text-red-700 underline underline-offset-4 hover:opacity-80">
                          Revoke
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 text-secondary" title={formatAbsoluteDate(member.invitedAt)}>
                      Invited {formatRelativeDate(member.invitedAt)}
                    </td>
                    <td className="px-4 py-2 text-secondary">Waiting to accept</td>
                    <td className="px-4 py-2 text-secondary">—</td>
                  </tr>
                ))}
                {pageItems.map((member) => {
                  const sharedCount = member.sharedSkills?.length ?? 0
                  const ratedCount = member.sharedSkills?.filter((skill) => skill.managerRating).length ?? 0
                  const collaborationCount = member.collaborativeLearningCount ?? 0
                  return (
                    <tr key={member.id} className="border-b border-hairline last:border-b-0 align-top">
                      <td className="px-4 py-2">
                        <button type="button" onClick={() => setProfileId(member.id)}
                          aria-label={`View skills profile for ${member.name}`}
                          className="flex items-center gap-2 group">
                          <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={7} />
                          <span className="text-ink group-hover:text-moss group-hover:underline">{member.name}</span>
                        </button>
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
                        {sharedCount > 0 ? (
                          <button type="button" onClick={() => setProfileId(member.id)}
                            className="text-left text-ink hover:text-moss hover:underline">
                            {sharedCount} shared · {ratedCount} rated by you
                          </button>
                        ) : (
                          <span className="text-secondary">Nothing shared yet</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-secondary">
                        {collaborationCount > 0 && onOpenCollaboration ? (
                          <button type="button" onClick={onOpenCollaboration}
                            aria-label={`View ${collaborationCount} collaborative learning record${collaborationCount === 1 ? '' : 's'}`}
                            className="text-moss hover:underline">
                            {collaborationCount}
                          </button>
                        ) : collaborationCount}
                      </td>
                    </tr>
                  )
                })}
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
          onInviteConnections={onInviteConnections}
          connections={connections}
          teamMemberships={teamMemberships}
        />
      )}
    </div>
  )
}

const MAX_EMAIL_ROWS = 10
const CONNECTION_SEARCH_THRESHOLD = 6

// One form, one submit: pick any number of connections (same searchable
// checkbox picker as the create-team form in ConnectionsTeams.jsx) and/or
// type any number of email addresses, then send the lot together. Each
// invite is sent independently by the caller -- `onInviteConnections(ids)`
// and `onInvite(emails)` both resolve to per-item { ok, error } results
// rather than throwing -- so one bad address doesn't sink the rest, and only
// the failures stay in the form to fix and resend.
function InviteToTeamDialog({ onClose, onInvite, onInviteConnections, connections, teamMemberships }) {
  const [emails, setEmails] = useState([''])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const statusById = new Map(teamMemberships
    .filter((membership) => ['active', 'pending'].includes(membership.status))
    .map((membership) => [membership.member_user_id, membership.status]))
  const canInviteConnections = connections.length > 0 && Boolean(onInviteConnections)
  const emailsToSend = emails.map((value) => value.trim()).filter(Boolean)
  const totalToSend = emailsToSend.length + selectedIds.size
  const visibleConnections = connections.filter((connection) =>
    connection.name?.toLowerCase().includes(query.trim().toLowerCase()))
  const firstSelectableId = visibleConnections.find((connection) => !statusById.has(connection.id))?.id

  function toggleConnection(id) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function updateEmail(index, value) {
    setEmails((previous) => previous.map((v, i) => (i === index ? value : v)))
  }

  function addEmailRow() {
    setEmails((previous) => (previous.length < MAX_EMAIL_ROWS ? [...previous, ''] : previous))
  }

  function removeEmailRow(index) {
    setEmails((previous) => (previous.length > 1 ? previous.filter((_, i) => i !== index) : previous))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (totalToSend === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const connectionIds = [...selectedIds]
      const [connectionResults, emailResults] = await Promise.all([
        connectionIds.length > 0 && onInviteConnections ? onInviteConnections(connectionIds) : [],
        emailsToSend.length > 0 && onInvite ? onInvite(emailsToSend) : [],
      ])
      const failedConnections = connectionResults.filter((r) => !r.ok)
      const failedEmails = emailResults.filter((r) => !r.ok)
      const failureCount = failedConnections.length + failedEmails.length
      if (failureCount === 0) {
        onClose()
        return
      }
      // Drop the ones that succeeded so a retry doesn't re-invite them --
      // only the failed connections/addresses stay in the form.
      setSelectedIds(new Set(failedConnections.map((f) => f.id)))
      setEmails(failedEmails.length > 0 ? failedEmails.map((f) => f.email) : [''])
      const nameById = new Map(connections.map((c) => [c.id, c.name]))
      setSubmitError(
        (failureCount < totalToSend ? `${totalToSend - failureCount} sent. ` : '') +
        [
          ...failedConnections.map((f) => `${nameById.get(f.id) ?? 'Connection'}: ${f.error}`),
          ...failedEmails.map((f) => `${f.email}: ${f.error}`),
        ].join('; ')
      )
    } catch (error) {
      setSubmitError(error.message || 'Could not send the invitations. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      label="Invite to team"
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <form onSubmit={handleSubmit}>
        <h2 className="font-display text-lg text-ink mb-1">Invite to team</h2>
        <p className="text-sm text-secondary mb-5">
          Choose connections, add email addresses, or both. They’ll appear here as invited until they accept
          and choose which skills to share.
        </p>

        {canInviteConnections && (
          <fieldset className="mb-5">
            <legend className="text-sm font-medium text-ink">Your connections</legend>
            {connections.length > CONNECTION_SEARCH_THRESHOLD && (
              <input type="text" value={query} disabled={submitting} placeholder="Search connections…"
                aria-label="Search connections" onChange={(event) => setQuery(event.target.value)}
                className="mt-1 mb-1 block w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink" />
            )}
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-hairline bg-paper divide-y divide-hairline">
              {visibleConnections.length === 0 && (
                <p className="px-3 py-2 text-sm text-secondary">No connections match “{query.trim()}”.</p>
              )}
              {visibleConnections.map((connection) => {
                const status = statusById.get(connection.id)
                return (
                  <label key={connection.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${status ? 'text-secondary' : 'text-ink'}`}>
                    <input type="checkbox" checked={Boolean(status) || selectedIds.has(connection.id)}
                      disabled={submitting || Boolean(status)} onChange={() => toggleConnection(connection.id)}
                      data-dialog-initial-focus={connection.id === firstSelectableId ? true : undefined}
                      className="rounded border-hairline accent-moss" />
                    <span className="flex-1">{connection.name}</span>
                    {status && <span className="text-xs">{status === 'pending' ? 'Invited' : 'On this team'}</span>}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )}

        <fieldset className="mb-2">
          <legend className="text-sm font-medium text-ink mb-1">Invite by email</legend>
          <p className="text-sm text-secondary mb-3">
            No LearnScope account yet? They’ll get a sign-up invite. Already have one? They’ll see it on their Actions page.
          </p>
          <div className="space-y-2">
            {emails.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <label htmlFor={`manager-team-invite-email-${index}`} className="sr-only">Email {index + 1}</label>
                <input
                  id={`manager-team-invite-email-${index}`}
                  type="email"
                  maxLength={320}
                  value={value}
                  onChange={(e) => updateEmail(index, e.target.value)}
                  disabled={submitting}
                  placeholder="name@example.com"
                  data-dialog-initial-focus={index === 0 && !firstSelectableId ? true : undefined}
                  className="flex-1 rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                />
                {emails.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEmailRow(index)}
                    disabled={submitting}
                    aria-label={`Remove email ${index + 1}`}
                    className="shrink-0 rounded-md border border-hairline text-secondary hover:text-red-700 px-2 py-2 text-sm disabled:opacity-60"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </fieldset>
        {emails.length < MAX_EMAIL_ROWS && (
          <button
            type="button"
            onClick={addEmailRow}
            disabled={submitting}
            className="text-xs font-medium text-moss hover:underline disabled:opacity-60 mb-3"
          >
            + Add another
          </button>
        )}
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
            disabled={submitting || totalToSend === 0}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Sending…' : totalToSend > 1 ? `Send ${totalToSend} invites` : 'Send invite'}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}

// Rates a single shared skill for a single member. `skill` is the chip's
// own shape ({ id, name, level, sharedAt, evidenceCount, managerRating }) --
// `skill.level` here is the member's own self-assessed level, shown for
// context only, never edited from here. `onLoadHistory` fetches this
// manager's own past ratings of this skill (id, level, comments,
// evidenceUrl, evidencePaths, assessedByName, assessedAt) once, on open;
// `onRate` submits a new one and receives { level, comments, evidenceUrl,
// files } -- attaching any files to the new rating is the caller's job
// (mirrors every other assessment-with-evidence flow: create the record,
// then upload keyed by its id), not this dialog's.
export function RateSkillDialog({ member, skill, onClose, onRate, onLoadHistory }) {
  const [level, setLevel] = useState(skill.managerRating?.level ?? skill.level ?? 1)
  const [comments, setComments] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState([])
  const [showEvidence, setShowEvidence] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    Promise.resolve(onLoadHistory?.())
      .then((rows) => {
        if (!cancelled) setHistory((rows ?? []).filter((row) => row.skillId === skill.id))
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [skill.id, onLoadHistory])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onRate({
        level,
        comments: comments.trim() || null,
        evidenceUrl: showEvidence ? evidenceUrl.trim() || null : null,
        files: showEvidence ? evidenceFiles : [],
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save this rating. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccessibleDialog
      label={`Rate ${skill.name}`}
      onClose={submitting ? undefined : onClose}
      closeOnBackdrop={!submitting}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 className="font-display text-lg text-ink mb-1">Rate {skill.name}</h2>
      <p className="text-sm text-secondary mb-4">
        {member.name} rates themselves at {LEVEL_LABELS[skill.level]}. Your rating is your own view --
        it's recorded separately and never changes {member.name}'s own self-assessment.
      </p>

      {!historyLoading && history.length > 0 && (
        <div className="mb-4 pb-4 border-b border-hairline space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-wide text-secondary">Your past ratings</p>
          {history.map((entry) => (
            <div key={entry.id} className="text-sm">
              <span className="text-ink">{LEVEL_LABELS[entry.level]}</span>
              <span className="text-secondary"> · {formatAbsoluteDate(entry.assessedAt)}</span>
              {entry.comments && <p className="text-secondary text-xs mt-0.5">{entry.comments}</p>}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <span className="block text-sm text-secondary mb-2">Your rating</span>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={`rounded-md border py-1.5 px-3 text-sm font-medium ${
                  level === l ? 'border-moss bg-moss/10 text-ink' : 'border-hairline text-secondary hover:bg-paper'
                }`}
              >
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="manager-rating-comments" className="block text-sm text-secondary mb-1">
            Comments
          </label>
          <textarea
            id="manager-rating-comments"
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="What have you observed?"
            className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-moss"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-secondary">
          <input
            type="checkbox"
            checked={showEvidence}
            onChange={(e) => setShowEvidence(e.target.checked)}
            className="rounded border-hairline"
          />
          Provide evidence
        </label>
        {showEvidence && (
          <EvidenceFields
            evidenceUrl={evidenceUrl}
            onEvidenceUrlChange={setEvidenceUrl}
            files={evidenceFiles}
            onFilesChange={setEvidenceFiles}
          />
        )}

        <MutationFeedback status="error" message={error} />

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-md bg-moss text-paper py-2 font-medium hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save rating'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            data-dialog-initial-focus
            className="rounded-md border border-hairline text-ink py-2 px-4 hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
