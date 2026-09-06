import { useState } from 'react'
import { Link } from 'react-router-dom'
import MutationFeedback from './MutationFeedback'

const controlClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60'

export default function ConnectionTeamInviteControl({ connection, teams = [], onInvite }) {
  const [open, setOpen] = useState(false)
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sentTeamId, setSentTeamId] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    if (!teamId) return
    setBusy(true); setError(null)
    try {
      await onInvite(teamId, connection.id)
      setSentTeamId(teamId); setOpen(false)
    } catch (err) {
      setError(err.message || `Could not invite ${connection.name}. Try again.`)
    } finally { setBusy(false) }
  }

  if (sentTeamId) return <p role="status" className="text-sm text-moss">
    Invitation sent to {teams.find((team) => team.id === sentTeamId)?.name ?? 'team'}.
  </p>

  return <div className="space-y-2">
    {!open && <button type="button" className={controlClass} onClick={() => setOpen(true)}>Add to team</button>}
    {open && (teams.length ? <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <label className="min-w-48 flex-1 text-sm text-ink">Team
        <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={busy}
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink">
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy || !teamId} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper disabled:opacity-60">{busy ? 'Sending…' : 'Send invite'}</button>
      <button type="button" disabled={busy} className={controlClass} onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
    </form> : <p className="text-sm text-secondary">Create a team in the <Link className="text-moss underline underline-offset-4" to="/connections?section=teams">Teams tab</Link> first.</p>)}
    <MutationFeedback status="error" message={error} />
  </div>
}
