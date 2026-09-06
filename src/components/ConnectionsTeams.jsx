import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createManagerWorkspace, createManagerTeam, listMyLedManagerTeams, listMyManagerTeamRelationships, listManagerTeamMembers, listManagerTeamRoster, inviteConnectionToManagerTeam, transferManagerTeamLeadership } from '../lib/managerTeams'
import MutationFeedback from './MutationFeedback'

const fieldClass = 'mt-1 block w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm text-ink'
const buttonClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-card disabled:opacity-60'

export default function ConnectionsTeams({ connections = [] }) {
  const { user, refreshWorkspaces } = useAuth()
  const [teams, setTeams] = useState([])
  const [teamId, setTeamId] = useState('')
  const [members, setMembers] = useState([])
  const [joinedTeams, setJoinedTeams] = useState([])
  const [roster, setRoster] = useState([])
  const [successorId, setSuccessorId] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)
  const [membersError, setMembersError] = useState(false)
  const [connectionId, setConnectionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
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

  useEffect(() => {
    setMembers([])
    setRoster([])
    setSuccessorId('')
    setTransferOpen(false)
    setMembersError(false)
    setConnectionId('')
    if (!teamId) return
    let active = true
    setMembersLoading(true)
    Promise.all([listManagerTeamMembers(teamId), listManagerTeamRoster(teamId)])
      .then(([rows, people]) => { if (active) { setMembers(rows); setRoster(people) } })
      .catch((err) => { if (active) { setMembersError(true); setError(err.message || 'Could not load team members. Try again.') } })
      .finally(() => { if (active) setMembersLoading(false) })
    return () => { active = false }
  }, [teamId, retry])

  async function handleCreate(event) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError(null); setNotice('')
    try {
      const workspaceId = await createManagerWorkspace()
      const id = await createManagerTeam(workspaceId, { name: name.trim() })
      setTeams((previous) => [...previous, { id, name: name.trim(), status: 'active' }])
      setTeamId(id); setCreating(false); setName('')
      setNotice('Team created. Choose a connection to invite below.')
      await refreshWorkspaces().catch(() => {})
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

  async function handleInvite(event) {
    event.preventDefault()
    if (!teamId || !connectionId) return
    setBusy(true); setError(null); setNotice('')
    try {
      await inviteConnectionToManagerTeam(teamId, connectionId)
      setMembers((previous) => [...previous, { member_user_id: connectionId, status: 'pending' }])
      setNotice(`Invitation sent to ${connections.find((c) => c.id === connectionId)?.name ?? 'your connection'}. They’ll appear in your team after accepting.`)
      setConnectionId('')
    } catch (err) { setError(err.message || 'Could not send the invitation. Try again.') }
    finally { setBusy(false) }
  }

  const liveMembers = new Map(members.filter((m) => ['active', 'pending'].includes(m.status)).map((m) => [m.member_user_id, m.status]))
  return <section aria-labelledby="connections-teams-title" className="space-y-4 border-b border-hairline pb-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="connections-teams-title" className="font-display text-xl text-ink">Your teams</h2>
      {!creating && <button type="button" disabled={busy || loading} onClick={() => { setCreating(true); setNotice('') }} className={buttonClass}>Create a team</button>}
    </div>
    <p className="text-sm text-secondary">Create and lead multiple teams, or join teams led by others. Invite your connections to learn together. Members choose which skills to share with their team leader.</p>
    {loading && <p role="status" className="text-sm text-secondary">Loading your teams…</p>}
    <MutationFeedback status="error" message={error} />
    {error && <button type="button" disabled={busy} className={buttonClass} onClick={() => setRetry((n) => n + 1)}>Reload teams</button>}
    <MutationFeedback status="success" message={notice} />
    {creating && <form onSubmit={handleCreate} className="max-w-lg space-y-3">
      <label className="block text-sm text-ink">Team name<input required maxLength={120} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} className={fieldClass} /></label>
      <div className="flex gap-2"><button type="submit" disabled={busy || !name.trim()} className={buttonClass}>{busy ? 'Creating…' : 'Create team'}</button>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => setCreating(false)}>Cancel</button></div>
    </form>}
    {!loading && teams.length === 0 && !creating && !error && <p className="text-sm text-secondary">No teams yet. Create your first team to start inviting connections.</p>}
    {teams.length > 0 && <div className="max-w-lg space-y-4">
      <div className="flex flex-wrap items-end gap-3"><label className="flex-1 min-w-48 text-sm text-ink">Team you lead<select disabled={busy} value={teamId} onChange={(e) => { setTeamId(e.target.value); setNotice(''); setError(null) }} className={fieldClass}>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select></label><Link to={`/manager?section=team&team=${encodeURIComponent(teamId)}`} className={`${buttonClass} inline-block`}>View team</Link></div>
      {connections.length > 0 ? <form onSubmit={handleInvite} className="space-y-3">
        <label className="block text-sm text-ink">Connection to invite<select value={connectionId} disabled={busy || membersLoading || membersError} onChange={(e) => setConnectionId(e.target.value)} className={fieldClass}>
          <option value="">{membersLoading ? 'Loading team members…' : 'Choose a connection'}</option>
          {connections.map((connection) => <option key={connection.id} value={connection.id} disabled={liveMembers.has(connection.id)}>
            {connection.name}{liveMembers.get(connection.id) === 'pending' ? ' — Invited' : liveMembers.get(connection.id) === 'active' ? ' — Already on team' : ''}
          </option>)}
        </select></label>
        <button type="submit" disabled={busy || membersLoading || membersError || !connectionId || liveMembers.has(connectionId)} className="rounded-md bg-moss text-paper px-4 py-2 text-sm font-medium disabled:opacity-60">{busy && !creating && !transferOpen ? 'Sending…' : 'Invite to team'}</button>
      </form> : <p className="text-sm text-secondary">Once you connect with someone, you can invite them to this team here.</p>}
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
