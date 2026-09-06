import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'
import {
  createManagerWorkspace, createManagerTeam, listMyLedManagerTeams, listMyArchivedManagerTeams,
  listMyManagerTeamRelationships, listManagerTeamMembers, listManagerTeamRoster, inviteConnectionToManagerTeam,
  inviteManagerTeamMemberByEmail, transferManagerTeamLeadership, listManagerTeamMemberSummaries,
  listManagerTeamLearningRecords, listManagerCollaborationRecords, createManagerCollaborationRecord,
  createManagerTeamSkillAssessment, setManagerTeamSkillAssessmentEvidence, listManagerTeamSkillAssessments,
  getManagerTeamSkillDetail, setManagerTeamSkillTarget, archiveManagerTeam, restoreManagerTeam,
  listMyManagerShareableSkills, setManagerTeamSharedSkills, leaveManagerTeam,
  listManagerTeamPendingMembers, revokeManagerTeamInvite, suggestManagerTeamSkill,
} from '../lib/managerTeams'
import MutationFeedback from './MutationFeedback'
import ConfirmDialog from './ConfirmDialog'
import ManagerSkillsPanel from '../pages/manager/ManagerSkillsPanel'
import ManagerTeamPanel from '../pages/manager/ManagerTeamPanel'
import ManagerLearningPanel from '../pages/manager/ManagerLearningPanel'
import ManagerCollaborationPanel from '../pages/manager/ManagerCollaborationPanel'
import ManagerTeamSharingPanel from '../pages/manager/learner/ManagerTeamSharingPanel'

const fieldClass = 'mt-1 block w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink'
const buttonClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-card disabled:opacity-60'

// A team leader (formerly a separate "manager console" at /manager) is the
// same concept as a Connections team's leader -- merged here so leading a
// team, from creating it through to rating shared skills, all happens in one
// place instead of handing off to a second console. PANELS mirrors the old
// console's own section shape (Skills/Members/Learning/Collaboration)
// exactly, reusing its panels verbatim; only the shell around them (this
// component) and where their data loads from changed.
const PANELS = [
  { key: 'skills', label: 'Skills' },
  { key: 'members', label: 'Members' },
  { key: 'learning', label: 'Learning' },
  { key: 'collaboration', label: 'Collaboration' },
]

// Builds "Alex", "Alex and Sam", or "Alex, Sam and Jo" from the leader's own
// name plus whoever is currently checked in the create-team member picker --
// only ever used to seed the (still-editable) name field's initial value.
function buildDefaultTeamName(selfName, memberNames) {
  const names = [selfName, ...memberNames].filter(Boolean)
  if (names.length <= 1) return names[0] || ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Every team a person is part of -- whether they lead it or joined someone
// else's -- lives in one selector now (previously a "Team you lead" dropdown
// plus a wholly separate "joined or invited" list at the bottom, each with
// its own detail view). `key` disambiguates a led team from a joined one
// sharing the same underlying team id (never actually possible for the same
// person, but keeps option values unique/stable regardless). Archived teams
// sort last within each group so the active, actionable ones stay on top.
function buildTeamOptions(ledTeams, archivedLedTeams, relationships) {
  const led = [...ledTeams, ...archivedLedTeams].map((t) => ({
    key: `lead:${t.id}`, id: t.id, name: t.name, role: 'leader', teamStatus: t.status,
  }))
  const joined = relationships
    .filter((r) => r.status === 'active')
    .map((r) => ({
      key: `member:${r.teamId}`, id: r.teamId, name: r.teamName, role: 'member',
      teamStatus: r.teamStatus, membership: r,
    }))
  return [...led, ...joined].sort((a, b) => {
    if ((a.teamStatus === 'archived') !== (b.teamStatus === 'archived')) {
      return a.teamStatus === 'archived' ? 1 : -1
    }
    return a.name.localeCompare(b.name)
  })
}

// A led team is the more actionable role, so it wins as the default view;
// otherwise the first active team of any kind, falling back to whatever's
// there (possibly archived) rather than showing nothing selectable.
function pickDefaultKey(options) {
  return options.find((t) => t.role === 'leader' && t.teamStatus === 'active')?.key
    ?? options.find((t) => t.teamStatus === 'active')?.key
    ?? options[0]?.key ?? ''
}

export default function ConnectionsTeams({ connections = [], currentUserName = '' }) {
  const { user, refreshWorkspaces } = useAuth()
  const [ledTeams, setLedTeams] = useState([])
  const [archivedLedTeams, setArchivedLedTeams] = useState([])
  const [relationships, setRelationships] = useState([])
  const [mySkills, setMySkills] = useState([])
  const [selectedKey, setSelectedKey] = useState('')
  const [members, setMembers] = useState([])
  const [roster, setRoster] = useState([])
  const [teamMemberSummaries, setTeamMemberSummaries] = useState([])
  const [pendingMembers, setPendingMembers] = useState([])
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [revoking, setRevoking] = useState(false)
  const [learningRecords, setLearningRecords] = useState([])
  const [collaborationRecords, setCollaborationRecords] = useState([])
  const [activePanel, setActivePanel] = useState('skills')
  const panelTabRefs = useRef({})
  const [successorId, setSuccessorId] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [membersError, setMembersError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [memberRoster, setMemberRoster] = useState([])
  const [memberAssessments, setMemberAssessments] = useState([])
  const [memberDetailLoading, setMemberDetailLoading] = useState(false)
  const [memberDetailError, setMemberDetailError] = useState(false)
  const [memberSaving, setMemberSaving] = useState(false)
  const [memberActionError, setMemberActionError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [initialMemberIds, setInitialMemberIds] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    Promise.all([
      listMyLedManagerTeams(), listMyArchivedManagerTeams(),
      listMyManagerTeamRelationships(), listMyManagerShareableSkills(user.id),
    ])
      .then(([led, archivedLed, relationshipRows, skills]) => {
        if (!active) return
        setLedTeams(led)
        setArchivedLedTeams(archivedLed)
        setRelationships(relationshipRows)
        setMySkills(skills)
        // Picked in the same update as the lists themselves (rather than a
        // separate effect reacting to them) so a fresh load never renders a
        // frame where the options are known but nothing is selected yet --
        // prefer the first active option so a brand-new or returning visitor
        // lands somewhere actionable rather than wherever archived teams
        // happen to sort. Keeps the current selection if it's still valid
        // (e.g. after archiving/restoring the very team being viewed).
        const options = buildTeamOptions(led, archivedLed, relationshipRows)
        setSelectedKey((previous) => (options.some((t) => t.key === previous) ? previous : pickDefaultKey(options)))
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load your teams. Try again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user.id, retry])

  const teamOptions = useMemo(
    () => buildTeamOptions(ledTeams, archivedLedTeams, relationships),
    [ledTeams, archivedLedTeams, relationships]
  )
  const pendingInvites = relationships.filter((r) => r.status === 'pending')

  const selected = teamOptions.find((t) => t.key === selectedKey) ?? null
  const teamId = selected?.role === 'leader' ? selected.id : ''

  // One led team's whole detail set -- membership roster (invite
  // eligibility), the leadership-transfer roster, the enriched member
  // summaries Skills/Members both read, and the Learning/Collaboration
  // records. Reloaded wholesale after any mutation below (invite, rating,
  // new record) the same way the old ManagerConsolePage did, rather than
  // each panel managing its own slice independently.
  const loadTeamDetail = useCallback(async (id) => {
    setMembersLoading(true)
    setMembersError(false)
    try {
      const [membershipRows, people, summaries, learning, collaboration, pending] = await Promise.all([
        listManagerTeamMembers(id), listManagerTeamRoster(id), listManagerTeamMemberSummaries(id),
        listManagerTeamLearningRecords(id), listManagerCollaborationRecords(id), listManagerTeamPendingMembers(id),
      ])
      setMembers(membershipRows)
      setRoster(people)
      setTeamMemberSummaries(summaries)
      setLearningRecords(learning)
      setCollaborationRecords(collaboration)
      setPendingMembers(pending)
    } catch (err) {
      setMembersError(true)
      setError(err.message || 'Could not load team members. Try again.')
    } finally {
      setMembersLoading(false)
    }
  }, [])

  useEffect(() => {
    setMembers([])
    setRoster([])
    setTeamMemberSummaries([])
    setLearningRecords([])
    setCollaborationRecords([])
    setPendingMembers([])
    setSuccessorId('')
    setTransferOpen(false)
    setMembersError(false)
    setActivePanel('skills')
    if (teamId) loadTeamDetail(teamId)
  }, [teamId, retry, loadTeamDetail])

  // Mirrors loadTeamDetail above but for a team the user has joined, not
  // led -- just the roster (who else is on it) and this manager's own
  // ratings of the skills shared with them, the same slice
  // ManagerTeamSharingPanel showed on Profile > Privacy before it moved here.
  useEffect(() => {
    if (selected?.role !== 'member') return
    let active = true
    setMemberDetailLoading(true)
    setMemberDetailError(false)
    Promise.allSettled([
      listManagerTeamRoster(selected.id),
      listManagerTeamSkillAssessments(selected.membership.id),
    ]).then(([rosterResult, assessmentResult]) => {
      if (!active) return
      setMemberRoster(rosterResult.status === 'fulfilled' ? rosterResult.value : [])
      setMemberAssessments(assessmentResult.status === 'fulfilled' ? assessmentResult.value : [])
      if (rosterResult.status === 'rejected' || assessmentResult.status === 'rejected') setMemberDetailError(true)
    }).finally(() => { if (active) setMemberDetailLoading(false) })
    return () => { active = false }
  }, [selected?.role, selected?.id, selected?.membership?.id])

  // Opening the form -- with exactly one connection to choose from, there's
  // no real choice to make, so pre-check them and seed the name from both
  // people; with none or several, leave it to the member picker below rather
  // than guess who belongs on the team.
  function startCreating() {
    const onlyConnection = connections.length === 1 ? connections[0] : null
    const seeded = onlyConnection ? new Set([onlyConnection.id]) : new Set()
    setInitialMemberIds(seeded)
    setName(buildDefaultTeamName(currentUserName, onlyConnection ? [onlyConnection.name] : []))
    setNameEdited(false)
    setCreating(true)
    setNotice('')
  }

  function toggleInitialMember(connectionId) {
    setInitialMemberIds((previous) => {
      const next = new Set(previous)
      if (next.has(connectionId)) next.delete(connectionId)
      else next.add(connectionId)
      if (!nameEdited) {
        const memberNames = connections.filter((c) => next.has(c.id)).map((c) => c.name)
        setName(buildDefaultTeamName(currentUserName, memberNames))
      }
      return next
    })
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError(null); setNotice('')
    try {
      const workspaceId = await createManagerWorkspace()
      const id = await createManagerTeam(workspaceId, { name: name.trim() })
      setLedTeams((previous) => [...previous, { id, name: name.trim(), status: 'active' }])
      setSelectedKey(`lead:${id}`); setCreating(false); setName(''); setNameEdited(false)
      await refreshWorkspaces().catch(() => {})
      const memberIds = [...initialMemberIds]
      setInitialMemberIds(new Set())
      if (memberIds.length > 0) {
        const results = await Promise.allSettled(memberIds.map((memberId) => inviteConnectionToManagerTeam(id, memberId)))
        const failureCount = results.filter((r) => r.status === 'rejected').length
        await loadTeamDetail(id)
        setNotice(
          failureCount > 0
            ? `Team created, but ${failureCount} of ${memberIds.length} member invitations couldn't be sent. Try inviting them from the Members tab below.`
            : 'Team created and members invited.'
        )
      } else {
        setNotice('Team created. Invite a connection from the Members tab below.')
      }
    } catch (err) { setError(err.message || 'Could not create your team. Try again.') }
    finally { setBusy(false) }
  }

  async function handleArchive() {
    setArchiving(true); setError(null)
    try {
      await archiveManagerTeam(teamId)
      setArchiveConfirmOpen(false)
      setRetry((n) => n + 1)
      setNotice('Team archived. You can still view it, but it can no longer be changed -- restore it any time.')
    } catch (err) { setError(err.message || 'Could not archive this team. Try again.') }
    finally { setArchiving(false) }
  }

  async function handleRestore() {
    setArchiving(true); setError(null)
    try {
      await restoreManagerTeam(teamId)
      setRetry((n) => n + 1)
      setNotice('Team restored.')
    } catch (err) { setError(err.message || 'Could not restore this team. Try again.') }
    finally { setArchiving(false) }
  }

  async function handleTransfer(event) {
    event.preventDefault()
    if (!successorId) return
    setBusy(true); setError(null); setNotice('')
    try {
      await transferManagerTeamLeadership(teamId, successorId)
      setNotice('Team leader changed. You are now a member of this team.')
      setLedTeams((previous) => previous.filter((team) => team.id !== teamId))
      setTransferOpen(false); setRetry((n) => n + 1)
    } catch (err) { setError(err.message || 'Could not change the team leader. Try again.') }
    finally { setBusy(false) }
  }

  // Invites each address independently (one bad/duplicate address shouldn't
  // sink the rest of a batch) and reports per-email results back to the
  // dialog rather than throwing, so it can drop the ones that succeeded and
  // leave only the failed ones for the leader to fix and retry.
  async function handleInviteByEmail(emails) {
    const results = await Promise.allSettled(emails.map((email) => inviteManagerTeamMemberByEmail(teamId, email)))
    await loadTeamDetail(teamId)
    return emails.map((email, i) => {
      const result = results[i]
      return result.status === 'fulfilled'
        ? { email, ok: true }
        : { email, ok: false, error: result.reason?.message || 'Could not send this invitation' }
    })
  }

  async function handleInviteConnection(connectionId) {
    await inviteConnectionToManagerTeam(teamId, connectionId)
    await loadTeamDetail(teamId)
  }

  async function handleRevokeInvite() {
    setRevoking(true); setError(null)
    try {
      await revokeManagerTeamInvite(revokeTarget.id)
      setRevokeTarget(null)
      await loadTeamDetail(teamId)
    } catch (err) { setError(err.message || 'Could not revoke this invitation. Try again.') }
    finally { setRevoking(false) }
  }

  async function handleCreateCollaborationRecord(record) {
    await createManagerCollaborationRecord(teamId, record)
    await loadTeamDetail(teamId)
  }

  // Same two-step shape as every other assessment-with-evidence flow (see
  // src/lib/skillEvidence.js): create the assessment first, then upload any
  // files keyed by its own id, under this leader's own storage folder (not
  // the member's), before attaching the resulting paths.
  async function handleRateSkill(membershipId, skillId, { level, comments, evidenceUrl, files }) {
    const assessmentId = await createManagerTeamSkillAssessment(membershipId, skillId, { level, comments, evidenceUrl })
    if (files?.length > 0) {
      const paths = await uploadEvidenceFiles(user.id, skillId, assessmentId, files)
      await setManagerTeamSkillAssessmentEvidence(assessmentId, paths)
    }
    await loadTeamDetail(teamId)
  }

  // Push, don't force: only ever creates a manager_team_skill_suggestions
  // row -- the member still has to explicitly adopt it (or not) from their
  // own Actions page, same as an employer's skill suggestion.
  async function handleSuggestSkill(membershipId, skillLibraryId, skillName, payload) {
    await suggestManagerTeamSkill(membershipId, skillLibraryId, skillName, payload)
  }

  async function handleManagerTeamShare(skillIds) {
    if (!selected?.membership) return
    setMemberActionError(null)
    setMemberSaving(true)
    try {
      await setManagerTeamSharedSkills(selected.membership.id, skillIds)
      setRelationships((current) => current.map((r) =>
        r.id === selected.membership.id ? { ...r, sharedSkillIds: skillIds } : r
      ))
    } catch (err) {
      setMemberActionError(err.message || 'Could not save your shared skills. Try again.')
    } finally {
      setMemberSaving(false)
    }
  }

  async function handleLeaveTeam() {
    if (!selected?.membership) return
    setMemberActionError(null)
    setMemberSaving(true)
    try {
      await leaveManagerTeam(selected.membership.id)
      const nextRelationships = relationships.filter((r) => r.id !== selected.membership.id)
      setRelationships(nextRelationships)
      setSelectedKey(pickDefaultKey(buildTeamOptions(ledTeams, archivedLedTeams, nextRelationships)))
    } catch (err) {
      setMemberActionError(err.message || 'Could not leave this team. Try again.')
    } finally {
      setMemberSaving(false)
    }
  }

  const collaborationMemberOptions = teamMemberSummaries.map((m) => ({ id: m.id, name: m.name }))
  const isArchived = selected?.teamStatus === 'archived'

  return <section aria-labelledby="connections-teams-title" className="space-y-4 border-b border-hairline pb-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="connections-teams-title" className="font-display text-xl text-ink">Teams you are part of</h2>
      {!creating && <button type="button" disabled={busy || loading} onClick={startCreating} className={buttonClass}>{ledTeams.length === 0 ? 'Form team' : 'Create a team'}</button>}
    </div>
    <p className="text-sm text-secondary">Create and lead multiple teams, or join teams led by others. Invite your connections to learn together. Members choose which skills to share with their team leader.</p>
    {loading && <p role="status" className="text-sm text-secondary">Loading your teams…</p>}
    <MutationFeedback status="error" message={error} />
    {error && <button type="button" disabled={busy} className={buttonClass} onClick={() => setRetry((n) => n + 1)}>Reload teams</button>}
    <MutationFeedback status="success" message={notice} />
    {creating && <form onSubmit={handleCreate} className="max-w-lg space-y-3">
      <label className="block text-sm text-ink">Team name
        <input required maxLength={120} value={name} disabled={busy}
          onChange={(e) => { setName(e.target.value); setNameEdited(true) }} className={fieldClass} />
      </label>
      {connections.length > 0 && <fieldset>
        <legend className="text-sm text-ink">Add members (optional)</legend>
        <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-hairline bg-card divide-y divide-hairline">
          {connections.map((connection) => (
            <label key={connection.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink">
              <input type="checkbox" checked={initialMemberIds.has(connection.id)} disabled={busy}
                onChange={() => toggleInitialMember(connection.id)} className="rounded border-hairline accent-moss" />
              {connection.name}
            </label>
          ))}
        </div>
      </fieldset>}
      <div className="flex gap-2"><button type="submit" disabled={busy || !name.trim()} className={buttonClass}>{busy ? 'Creating…' : 'Create team'}</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => setCreating(false)}>Cancel</button></div>
    </form>}
    {!loading && teamOptions.length === 0 && pendingInvites.length === 0 && !creating && !error && (
      <p className="text-sm text-secondary">No teams yet. Create your first team, or wait for an invitation.</p>
    )}

    {teamOptions.length > 0 && <div className="space-y-4">
      {teamOptions.length > 1 ? (
        <label className="block max-w-sm text-sm text-ink">Team
          <select disabled={busy} value={selectedKey} onChange={(e) => { setSelectedKey(e.target.value); setNotice(''); setError(null) }} className={fieldClass}>
            {teamOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}{t.role === 'member' ? ` · led by ${t.membership.managerName}` : ''}{t.teamStatus === 'archived' ? ' (Archived)' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <h3 className="font-display text-lg text-ink">
          {teamOptions[0].name}{teamOptions[0].teamStatus === 'archived' ? ' (Archived)' : ''}
        </h3>
      )}

      {isArchived && (
        <p role="status" className="text-sm text-secondary bg-paper border border-hairline rounded-md px-3 py-2">
          This team has been archived -- you can still view it below, but nothing new can be added.
          {selected.role === 'leader' && ' Restore it to make changes again.'}
        </p>
      )}

      {selected?.role === 'leader' && <div className={`space-y-4 ${isArchived ? 'opacity-75' : ''}`}>
        <div role="tablist" aria-label="Team section" className="flex items-center flex-wrap gap-1 border-b border-hairline">
          {PANELS.map((panel) => (
            <button key={panel.key} type="button" role="tab"
              ref={(el) => { panelTabRefs.current[panel.key] = el }}
              id={`team-panel-tab-${panel.key}`}
              aria-selected={activePanel === panel.key}
              aria-controls={`team-panel-${panel.key}`}
              tabIndex={activePanel === panel.key ? 0 : -1}
              onClick={() => setActivePanel(panel.key)}
              onKeyDown={(event) => handleTabListKeyDown(event, {
                keys: PANELS.map((p) => p.key), activeKey: activePanel, refs: panelTabRefs, onChange: setActivePanel,
              })}
              className={`text-sm px-3 py-2 -mb-px border-b-2 whitespace-nowrap ${activePanel === panel.key
                ? 'border-moss text-ink font-medium'
                : 'border-transparent text-secondary hover:text-ink'}`}>
              {panel.label}
            </button>
          ))}
        </div>

        <div id={`team-panel-${activePanel}`} role="tabpanel" aria-labelledby={`team-panel-tab-${activePanel}`} tabIndex={0}>
          {activePanel === 'skills' && (
            <ManagerSkillsPanel members={teamMemberSummaries} loading={membersLoading} error={membersError ? error : null}
              onRateSkill={isArchived ? undefined : handleRateSkill} onLoadSkillAssessments={listManagerTeamSkillAssessments}
              onLoadSkillDetail={getManagerTeamSkillDetail} onSetTarget={isArchived ? undefined : setManagerTeamSkillTarget}
              onSuggestSkill={isArchived ? undefined : handleSuggestSkill} />
          )}
          {activePanel === 'members' && (
            <ManagerTeamPanel members={teamMemberSummaries} pendingMembers={pendingMembers}
              loading={membersLoading} error={membersError ? error : null}
              onInvite={handleInviteByEmail} onInviteConnection={handleInviteConnection}
              onRevokeInvite={isArchived ? undefined : (person) => setRevokeTarget(person)}
              connections={connections} teamMemberships={members} readOnly={isArchived}
              onRateSkill={isArchived ? undefined : handleRateSkill} onLoadSkillAssessments={listManagerTeamSkillAssessments}
              onLoadSkillDetail={getManagerTeamSkillDetail} onSetTarget={isArchived ? undefined : setManagerTeamSkillTarget}
              onSuggestSkill={isArchived ? undefined : handleSuggestSkill} />
          )}
          {activePanel === 'learning' && (
            <ManagerLearningPanel records={learningRecords} loading={membersLoading} error={membersError ? error : null} />
          )}
          {activePanel === 'collaboration' && (
            <ManagerCollaborationPanel records={collaborationRecords} teamOptions={collaborationMemberOptions}
              loading={membersLoading} error={membersError ? error : null} onCreateRecord={handleCreateCollaborationRecord}
              readOnly={isArchived} />
          )}
        </div>

        {!isArchived && !transferOpen && <button type="button" disabled={busy || membersLoading || membersError} onClick={() => setTransferOpen(true)} className={buttonClass}>Change team leader</button>}
        {!isArchived && transferOpen && <form onSubmit={handleTransfer} className="space-y-3 border-t border-hairline pt-4">
          <label className="block text-sm text-ink">New team leader<select value={successorId} disabled={busy} onChange={(e) => setSuccessorId(e.target.value)} className={fieldClass}>
            <option value="">Choose a team member</option>
            {roster.filter((person) => person.role === 'member').map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select></label>
          <p className="text-sm text-secondary">Choose a member who has accepted their invitation. You’ll remain a member and lose leader controls. Members will need to share their skills with the new leader.</p>
          <div className="flex gap-2"><button type="submit" disabled={busy || !successorId} className={buttonClass}>{busy ? 'Changing…' : 'Transfer leadership'}</button>
            <button type="button" disabled={busy} onClick={() => setTransferOpen(false)} className={buttonClass}>Cancel</button></div>
        </form>}

        <div className="border-t border-hairline pt-4">
          {isArchived ? (
            <button type="button" disabled={archiving} onClick={handleRestore} className={buttonClass}>{archiving ? 'Restoring…' : 'Restore team'}</button>
          ) : (
            <button type="button" disabled={archiving || membersLoading} onClick={() => setArchiveConfirmOpen(true)} className={`${buttonClass} text-red-700`}>Archive team</button>
          )}
        </div>
      </div>}

      {selected?.role === 'member' && memberDetailLoading && (
        <p className="text-sm text-secondary">Loading…</p>
      )}
      {selected?.role === 'member' && !memberDetailLoading && (
        <ManagerTeamSharingPanel
          membership={selected.membership}
          availableSkills={mySkills}
          sharedSkillIds={selected.membership.sharedSkillIds}
          roster={memberRoster}
          assessments={memberAssessments}
          saving={memberSaving}
          error={memberDetailError ? 'Could not load this team’s details.' : memberActionError}
          onSave={handleManagerTeamShare}
          onLeaveTeam={handleLeaveTeam}
          readOnly={isArchived}
        />
      )}
    </div>}

    {archiveConfirmOpen && (
      <ConfirmDialog
        message={`Archive "${selected?.name}"? It stays viewable -- including its members, ratings and history -- but no one can invite new members, rate skills, or log new activities or collaboration records until you restore it.`}
        confirmLabel="Archive team"
        onConfirm={handleArchive}
        onCancel={() => setArchiveConfirmOpen(false)}
        confirming={archiving}
      />
    )}

    {revokeTarget && (
      <ConfirmDialog
        message={`Revoke the invitation to "${revokeTarget.name}"? They'll no longer be able to accept it -- you can invite them again later if you change your mind.`}
        confirmLabel="Revoke"
        onConfirm={handleRevokeInvite}
        onCancel={() => setRevokeTarget(null)}
        confirming={revoking}
      />
    )}

    {pendingInvites.length > 0 && <div className="space-y-3 pt-4">
      <h3 className="font-display text-lg text-ink">Invitations</h3>
      <ul className="divide-y divide-hairline">{pendingInvites.map((membership) => (
        <li key={membership.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="text-sm font-medium text-ink">{membership.teamName}</p><p className="text-sm text-secondary">Led by {membership.managerName} · Invitation pending</p></div>
          <Link className="text-sm text-moss underline underline-offset-4" to="/actions">Respond to invitation</Link>
        </li>
      ))}</ul>
    </div>}
  </section>
}
