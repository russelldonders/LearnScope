import { useEffect, useRef, useState } from 'react'
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

// Team roster is a projection over the manager's own connections (manager
// mode extends connections, it isn't a lightweight employer with its own
// member profiles). Deliberately narrow: each row shows only what a member
// has explicitly shared with this manager -- `sharedSkills` (with a level
// and evidence count, never the member's full skill list) and a count of
// team-scoped collaborative learning they're part of (see
// ManagerLearningPanel) -- never their complete learner profile.
//
// Sharing a skill is also what lets the manager rate it -- each shared-skill
// chip has a "Rate" action opening RateSkillDialog, which shows this
// manager's own rating history for that skill (via `onLoadSkillAssessments`)
// and records a new one (via `onRateSkill`); a rating is its own record,
// never rewriting the member's own self-assessed level shown on the chip.
// `members`, `loading`, `error`, `onInvite`, `onRateSkill` and
// `onLoadSkillAssessments` are the only contract with the data layer; this
// component never fetches or writes anything itself outside of those.
export default function ManagerTeamPanel({
  members = [], loading = false, error = null, onInvite, onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget,
}) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [rateTarget, setRateTarget] = useState(null)
  const [profileId, setProfileId] = useState(null)
  const profileMember = members.find((member) => member.id === profileId)
  const { sortKey, sortDir, toggleSort, page, setPage, pageSize, setPageSize, pageItems, totalItems } =
    useSortedPage(members, SORT_ACCESSORS, { defaultSortKey: 'name' })

  if (profileMember) return <ManagerMemberProfile member={profileMember} onBack={() => setProfileId(null)}
    onRateSkill={onRateSkill} onLoadSkillAssessments={onLoadSkillAssessments}
    onLoadSkillDetail={onLoadSkillDetail} onSetTarget={onSetTarget} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-secondary">
          Open a team member’s skills profile, then choose a skill to review their progress, rate it or set a target.
          Profiles show the skills they’ve shared with you.
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
                      <button type="button" onClick={() => setProfileId(member.id)}
                        aria-label={`View skills profile for ${member.name}`}
                        className="mt-2 text-sm font-medium text-moss underline underline-offset-4 hover:text-ink">
                        View skills profile
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
                      {member.sharedSkills?.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {member.sharedSkills.map((skill) => (
                            <div key={skill.id} className="flex flex-col items-start gap-0.5">
                              <span
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
                              <div className="flex items-center gap-1.5 pl-1">
                                {skill.managerRating && (
                                  <span
                                    title={`You rated this ${formatAbsoluteDate(skill.managerRating.assessedAt)}`}
                                    className="text-[11px] text-secondary"
                                  >
                                    Your rating: {LEVEL_LABELS[skill.managerRating.level]}
                                  </span>
                                )}
                                {onRateSkill && (
                                  <button
                                    type="button"
                                    onClick={() => setRateTarget({ member, skill })}
                                    className="text-[11px] font-medium text-moss hover:underline"
                                  >
                                    {skill.managerRating ? 'Rate again' : 'Rate'}
                                  </button>
                                )}
                              </div>
                            </div>
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

      {rateTarget && (
        <RateSkillDialog
          member={rateTarget.member}
          skill={rateTarget.skill}
          onClose={() => setRateTarget(null)}
          onRate={(payload) => onRateSkill(rateTarget.member.id, rateTarget.skill.id, payload)}
          onLoadHistory={() => onLoadSkillAssessments?.(rateTarget.member.id, rateTarget.skill.id)}
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
