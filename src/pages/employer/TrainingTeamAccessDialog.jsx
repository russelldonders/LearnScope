import { useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import MutationFeedback from '../../components/MutationFeedback'
import { inviteOrganisationStaff, removeOrganisationMember } from '../../lib/admin/organisations'

export default function TrainingTeamAccessDialog({ organisation, members, onClose, onUpdated }) {
  const [role, setRole] = useState('trainer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [completed, setCompleted] = useState(new Set())
  const eligible = members.filter((member) => !member.trainingAccess && !completed.has(member.user_id) && member.email
    && !(member.employerMember && member.role === 'admin' && member.status === 'active'))

  async function assign(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const succeeded = []
    const failures = []
    for (const member of eligible) {
      try {
        await inviteOrganisationStaff(organisation.id, member.email, role)
        succeeded.push(member.user_id)
      } catch (err) {
        failures.push(`${member.email}: ${err.message}`)
      }
    }
    setCompleted((previous) => new Set([...previous, ...succeeded]))
    if (succeeded.length) setMessage(`Training access requested for ${succeeded.length} user(s). They can accept it on their Actions page.`)
    if (failures.length) setError(failures.join(' '))
    await onUpdated()
    setBusy(false)
  }

  async function remove(member) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await removeOrganisationMember(member.trainingAccess.id)
      setCompleted((previous) => {
        const next = new Set(previous)
        next.delete(member.user_id)
        return next
      })
      setMessage(`Training access removed for ${member.email || member.user_id}.`)
      await onUpdated()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccessibleDialog labelledBy="training-team-access-title" onClose={busy ? undefined : onClose} closeOnBackdrop={!busy}
      panelClassName="w-full max-w-2xl bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain">
      <h2 id="training-team-access-title" className="font-display text-xl text-ink mb-2">Training team access</h2>
      <p className="text-sm text-secondary mb-4">Manage access to {organisation.name}'s training catalogue for the selected users. Admins manage the training team; trainers create and maintain training content.</p>
      <ul className="divide-y divide-hairline mb-5">
        {members.map((member) => {
          const automatic = member.employerMember && member.role === 'admin' && member.status === 'active'
          return (
            <li key={member.user_id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="text-ink break-all">{member.email || member.user_id}</p>
                <p className="text-xs text-secondary mt-1">
                  {automatic ? 'Admin — automatic employer admin access' : member.trainingAccess
                    ? `${member.trainingAccess.role === 'admin' ? 'Admin' : 'Trainer'}${member.trainingAccess.status === 'pending' ? ' — awaiting acceptance' : ' — active'}`
                    : completed.has(member.user_id) ? 'Access requested' : 'No training access'}
                </p>
                {!member.email && !member.trainingAccess && <p className="text-xs text-secondary">An email address is required to request access.</p>}
              </div>
              {member.trainingAccess && !automatic && <button type="button" disabled={busy} onClick={() => remove(member)} className="text-xs text-red-700 hover:underline disabled:opacity-60">Remove training access<span className="sr-only"> for {member.email || member.user_id}</span></button>}
            </li>
          )
        })}
      </ul>
      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />
      <MutationFeedback status="success" message={message} size="xs" className="mb-3" />
      <form onSubmit={assign} className="space-y-4">
        {eligible.length > 0 && <div>
          <label htmlFor="training-access-role" className="block text-xs text-secondary mb-1">Training access role</label>
          <select id="training-access-role" value={role} disabled={busy} onChange={(event) => setRole(event.target.value)} className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss">
            <option value="trainer">Trainer</option>
            <option value="admin">Admin</option>
          </select>
          <p className="text-xs text-secondary mt-2">Applies to {eligible.length} selected user(s) without training access. Existing roles are kept.</p>
        </div>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-hairline text-ink py-2 px-4 text-sm hover:bg-paper disabled:opacity-60">Close</button>
          {eligible.length > 0 && <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60">{busy ? 'Saving…' : 'Assign access role'}</button>}
        </div>
      </form>
    </AccessibleDialog>
  )
}
