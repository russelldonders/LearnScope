import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { uploadEvidenceFiles } from '../lib/skillEvidence'
import { handleTabListKeyDown } from '../lib/tabsKeyboard'
import {
  createManagerWorkspace, createManagerTeam, listMyLedManagerTeams, listMyManagerTeamRelationships,
  listManagerTeamMembers, listManagerTeamRoster, inviteConnectionToManagerTeam, inviteConnectionToManagerTeamByEmail,
  transferManagerTeamLeadership, listManagerTeamMemberSummaries, listManagerTeamLearningRecords,
  listManagerCollaborationRecords, createManagerCollaborationRecord, createManagerTeamSkillAssessment,
  setManagerTeamSkillAssessmentEvidence, listManagerTeamSkillAssessments, getManagerTeamSkillDetail, setManagerTeamSkillTarget,
} from '../lib/managerTeams'
import MutationFeedback from './MutationFeedback'
import ManagerSkillsPanel from '../pages/manager/ManagerSkillsPanel'
import ManagerTeamPanel from '../pages/manager/ManagerTeamPanel'
import ManagerLearningPanel from '../pages/manager/ManagerLearningPanel'
import ManagerCollaborationPanel from '../pages/manager/ManagerCollaborationPanel'

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

export default function ConnectionsTeams({ connections = [], currentUserName = '' }) {
  const { user, refreshWorkspaces } = useAuth()
  const [teams, setTeams] = useState([])
  const [teamId, setTeamId] = useState('')
  const [members, setMembers] = useState([])
  const [joinedTeams, setJoinedTeams] = useState([])
  const [roster, setRoster] = useState([])
  const [teamMemberSummaries, setTeamMemberSummaries] = useState([])
  const [learningRecords, setLearningRecords] = useState([])
  const [collaborationRecords, setCollaborationRecords] = useState([])
  const [activePanel, setActivePanel] = useState('skills')
  const panelTabRefs = useRef({})
  const [successorId, setSuccessorId] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [membersError, setMembersError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)
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
    Promise.all([listMyLedManagerTeams(), listMyManagerTeamRelationships()])
      .then(([rows, relationships]) => {
        if (!active) return
        const available = rows.filter((t) => t.status === 'active')
        setTeams(available)
        setJoinedTeams(relationships)
        setTeamId((previous) => available.some((t) => t.id === previous) ? previous : available[0]?.id ?? '')
      })
      .catch((err) => { if (active) setError(err.message || 'Could not load your teams. Try again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user.id, retry])

  // One team's whole detail set -- membership roster (invite eligibility),
  // the leadership-transfer roster, the enriched member summaries Skills/
  // Members both read, and the Learning/Collaboration records. Reloaded
  // wholesale after any mutation below (invite, rating, new record) the same
  // way the old ManagerConsolePage did, rather than each panel managing its
  // own slice independently.
  const loadTeamDetail = useCallback(async (id) => {
    setMembersLoading(true)
    setMembersError(false)
    try {
      const [membershipRows, people, summaries, learning, collaboration] = await Promise.all([
        listManagerTeamMembers(id), listManagerTeamRoster(id), listManagerTeamMemberSummaries(id),
        listManagerTeamLearningRecords(id), listManagerCollaborationRecords(id),
      ])
      setMembers(membershipRows)
      setRoster(people)
      setTeamMemberSummaries(summaries)
      setLearningRecords(learning)
      setCollaborationRecords(collaboration)
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
    setSuccessorId('')
    setTransferOpen(false)
    setMembersError(false)
    setActivePanel('skills')
    if (teamId) loadTeamDetail(teamId)
  }, [teamId, retry, loadTeamDetail])

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
      setTeams((previous) => [...previous, { id, name: name.trim(), status: 'active' }])
      setTeamId(id); setCreating(false); setName(''); setNameEdited(false)
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

  async function handleTransfer(event) {
    event.preventDefault()
    if (!successorId) return
    setBusy(true); setError(null); setNotice('')
    try {
      await transferManagerTeamLeadership(teamId, successorId)
      setNotice('Team leader changed. You are now a member of this team.')
      setTeams((previous) => previous.filter((team) => team.id !== teamId))
      setTeamId(''); setTransferOpen(false); setRetry((n) => n + 1)
    } catch (err) { setError(err.message || 'Could not change the team leader. Try again.') }
    finally { setBusy(false) }
  }

  async function handleInviteByEmail(email) {
    await inviteConnectionToManagerTeamByEmail(teamId, email)
    await loadTeamDetail(teamId)
  }

  async function handleInviteConnection(connectionId) {
    await inviteConnectionToManagerTeam(teamId, connectionId)
    await loadTeamDetail(teamId)
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

  const collaborationMemberOptions = teamMemberSummaries.map((m) => ({ id: m.id, name: m.name }))

  return <section aria-labelledby="connections-teams-title" className="space-y-4 border-b border-hairline pb-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="connections-teams-title" className="font-display text-xl text-ink">Your teams</h2>
      {!creating && <button type="button" disabled={busy || loading} onClick={startCreating} className={buttonClass}>{teams.length === 0 ? 'Form team' : 'Create a team'}</button>}
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
    {!loading && teams.length === 0 && !creating && !error && <p className="text-sm text-secondary">No teams yet. Create your first team to start inviting connections.</p>}
    {teams.length > 0 && <div className="space-y-4">
      <label className="block max-w-sm text-sm text-ink">Team you lead<select disabled={busy} value={teamId} onChange={(e) => { setTeamId(e.target.value); setNotice(''); setError(null) }} className={fieldClass}>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select></label>

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
            onRateSkill={handleRateSkill} onLoadSkillAssessments={listManagerTeamSkillAssessments}
            onLoadSkillDetail={getManagerTeamSkillDetail} onSetTarget={setManagerTeamSkillTarget} />
        )}
        {activePanel === 'members' && (
          <ManagerTeamPanel members={teamMemberSummaries} loading={membersLoading} error={membersError ? error : null}
            onInvite={handleInviteByEmail} onInviteConnection={handleInviteConnection}
            connections={connections} teamMemberships={members}
            onRateSkill={handleRateSkill} onLoadSkillAssessments={listManagerTeamSkillAssessments}
            onLoadSkillDetail={getManagerTeamSkillDetail} onSetTarget={setManagerTeamSkillTarget} />
        )}
        {activePanel === 'learning' && (
          <ManagerLearningPanel records={learningRecords} loading={membersLoading} error={membersError ? error : null} />
        )}
        {activePanel === 'collaboration' && (
          <ManagerCollaborationPanel records={collaborationRecords} teamOptions={collaborationMemberOptions}
            loading={membersLoading} error={membersError ? error : null} onCreateRecord={handleCreateCollaborationRecord} />
        )}
      </div>

      {!transferOpen && <button type="button" disabled={busy || membersLoading || membersError} onClick={() => setTransferOpen(true)} className={buttonClass}>Change team leader</button>}
      {transferOpen && <form onSubmit={handleTransfer} className="space-y-3 border-t border-hairline pt-4">
        <label className="block text-sm text-ink">New team leader<select value={successorId} disabled={busy} onChange={(e) => setSuccessorId(e.target.value)} className={fieldClass}>
          <option value="">Choose a team member</option>
          {roster.filter((person) => person.role === 'member').map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>
        <p className="text-sm text-secondary">Choose a member who has accepted their invitation. You’ll remain a member and lose leader controls. Members will need to share their skills with the new leader.</p>
        <div className="flex gap-2"><button type="submit" disabled={busy || !successorId} className={buttonClass}>{busy ? 'Changing…' : 'Transfer leadership'}</button>
          <button type="button" disabled={busy} onClick={() => setTransferOpen(false)} className={buttonClass}>Cancel</button></div>
      </form>}
    </div>}
    {joinedTeams.length > 0 && <div className="space-y-3 pt-4">
      <h3 className="font-display text-lg text-ink">Teams you’ve joined or been invited to</h3>
      <ul className="divide-y divide-hairline">{joinedTeams.map((membership) => <li key={membership.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="text-sm font-medium text-ink">{membership.teamName}</p><p className="text-sm text-secondary">Led by {membership.managerName} · {membership.status === 'pending' ? 'Invitation pending' : 'Member'}</p></div>
        <Link className="text-sm text-moss underline underline-offset-4" to={membership.status === 'pending' ? '/actions' : '/profile/privacy'}>{membership.status === 'pending' ? 'Respond to invitation' : 'View team and sharing'}</Link>
      </li>)}</ul>
    </div>}
  </section>
}
