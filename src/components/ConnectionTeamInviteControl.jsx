import { useState } from 'react'
import MutationFeedback from './MutationFeedback'
import { useLanguage } from '../context/LanguageContext'

const controlClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-paper disabled:opacity-60'

export default function ConnectionTeamInviteControl({ connection, teams = [], onInvite, onCreateTeam }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '')
  const [teamName, setTeamName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sentTeamName, setSentTeamName] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    if (!teamId) return
    setBusy(true); setError(null)
    try {
      await onInvite(teamId, connection.id)
      setSentTeamName(teams.find((team) => team.id === teamId)?.name ?? t('teams.inviteConnection.fallbackTeamName')); setOpen(false)
    } catch (err) {
      setError(err.message || t('teams.inviteConnection.inviteError', { name: connection.name }))
    } finally { setBusy(false) }
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!teamName.trim() || !onCreateTeam) return
    setBusy(true); setError(null)
    try {
      const team = await onCreateTeam(teamName.trim())
      await onInvite(team.id, connection.id)
      setSentTeamName(team.name); setOpen(false)
    } catch (err) {
      setError(err.message || t('teams.inviteConnection.createError', { name: connection.name }))
    } finally { setBusy(false) }
  }

  if (sentTeamName) return <p role="status" className="mt-3 text-sm text-moss">{t('teams.inviteConnection.sent', { team: sentTeamName })}</p>

  // Closed state stays a small inline link with no border/section of its
  // own -- it used to be a permanently-visible bordered block on every
  // connection card regardless of whether anyone was using it, adding real
  // vertical weight to a long connections list for an occasional action.
  // The border/padding only returns once there's an actual form to set off
  // from the card above it.
  if (!open) {
    return (
      <button
        type="button"
        className="mt-2 text-xs font-medium text-secondary hover:text-ink hover:underline"
        onClick={() => { setOpen(true); setCreatingNew(teams.length === 0) }}
      >
        {t('teams.inviteConnection.addToTeam')}
      </button>
    )
  }

  return <div className="mt-3 border-t border-hairline pt-3 space-y-2">
    {!creatingNew && teams.length > 0 && <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <label className="min-w-48 flex-1 text-sm text-ink">{t('teams.inviteConnection.team')}
        <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={busy}
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink">
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy || !teamId} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper disabled:opacity-60">{busy ? t('teams.inviteConnection.sending') : t('teams.inviteConnection.sendInvite')}</button>
      {onCreateTeam && <button type="button" disabled={busy} className={controlClass} onClick={() => setCreatingNew(true)}>{t('teams.inviteConnection.createNewTeam')}</button>}
      <button type="button" disabled={busy} className={controlClass} onClick={() => { setOpen(false); setError(null) }}>{t('teams.inviteConnection.cancel')}</button>
    </form>}
    {creatingNew && <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
      <label className="min-w-48 flex-1 text-sm text-ink">{t('teams.inviteConnection.newTeamName')}
        <input required maxLength={120} value={teamName} onChange={(event) => setTeamName(event.target.value)} disabled={busy} autoFocus
          className="mt-1 block w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink" />
      </label>
      <button type="submit" disabled={busy || !teamName.trim()} className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-paper disabled:opacity-60">{busy ? t('teams.inviteConnection.creatingAndInviting') : t('teams.inviteConnection.createAndInvite', { name: connection.name })}</button>
      {teams.length > 0 && <button type="button" disabled={busy} className={controlClass} onClick={() => setCreatingNew(false)}>{t('teams.inviteConnection.chooseExisting')}</button>}
      <button type="button" disabled={busy} className={controlClass} onClick={() => { setOpen(false); setError(null) }}>{t('teams.inviteConnection.cancel')}</button>
    </form>}
    <MutationFeedback status="error" message={error} />
  </div>
}
