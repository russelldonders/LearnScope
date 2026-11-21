import { useEffect, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import MutationFeedback from '../../components/MutationFeedback'
import { listEmployerRoleProfiles, assignEmployerRoleProfile, isRoleProfileActive } from '../../lib/employerRoleProfiles'

// Role profile picker for the "Assign role profile" bulk action on the Users
// tab's learner roster (EmployerLearnersPanel) -- mirrors AssignTrainingModal/
// AssignSkillModal's shape, except assign_employer_role_profile only takes
// one employer_member_id at a time (no bulk RPC, unlike course/skill
// assignment), so this calls it once per selected member via
// Promise.allSettled and reports failures as skipped, same partial-failure
// shape as EmployerRosterUploadPanel's CSV import. Assigning only
// *proposes* the role (same as RoleProfileLinkedEmployeesPanel's own
// onAssignEmployees) -- each employee still has to accept it themselves and
// link it to one of their own current roles before it's linked. The RPC
// also only accepts an active employer_members row with role='member', so a
// selected employer admin always lands in the skipped bucket -- selection
// here isn't filtered to exclude them (the roster's own "active" filter is
// shared across all three bulk actions), so that's reported the same way as
// an already-live assignment rather than distinguished.
export default function AssignRoleModal({ employer, members, skippedCount = 0, onClose, onAssigned }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [assignDates, setAssignDates] = useState({ start: '', end: '' })
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    listEmployerRoleProfiles(employer.id)
      .then((data) => setProfiles(data.filter(isRoleProfileActive)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [employer.id])

  async function handleAssign(e) {
    e.preventDefault()
    if (!selectedProfileId) return
    setAssigning(true)
    setError(null)
    try {
      const results = await Promise.allSettled(
        members.map((member) => assignEmployerRoleProfile(
          selectedProfileId,
          member.id,
          assignDates.start || null,
          assignDates.end || null
        ))
      )
      const skippedEmails = members
        .filter((_, index) => results[index].status === 'rejected')
        .map((member) => member.email || member.user_id)
      onAssigned({ kind: 'role', count: results.length - skippedEmails.length, skippedEmails })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="assign-role-dialog-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-role-dialog-title" className="font-display text-xl text-ink mb-1">Assign role profile</h2>
      <p className="text-sm text-secondary mb-4">
        Propose one of {employer.name}'s role profiles to {members.length} selected learner{members.length === 1 ? '' : 's'}.
        They'll see it on their Actions page and choose whether to link it to one of their own current roles --
        this doesn't change their profile automatically.
      </p>
      {skippedCount > 0 && (
        <p className="text-xs text-secondary mb-4">
          {skippedCount} of the selected user{skippedCount === 1 ? '' : 's'} {skippedCount === 1 ? 'is' : 'are'} not an active employer member and won't be included.
        </p>
      )}

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading role profiles…</p>
      ) : profiles.length === 0 ? (
        <p className="text-sm text-secondary">
          No role profiles yet — create one from the Role profiles tab first.
        </p>
      ) : (
        <form onSubmit={handleAssign} className="space-y-4">
          <div>
            <label className="block text-xs text-secondary mb-1" htmlFor="employerAssignRoleProfile">
              Role profile
            </label>
            <select
              id="employerAssignRoleProfile"
              required
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              className="w-full rounded-md border border-hairline bg-paper px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
            >
              <option value="">Choose a role profile…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-secondary">
              Start date (optional)
              <input
                type="date"
                value={assignDates.start}
                disabled={assigning}
                onChange={(e) => setAssignDates((prev) => ({ ...prev, start: e.target.value }))}
                className="mt-1 block rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="text-xs text-secondary">
              End date (optional)
              <input
                type="date"
                value={assignDates.end}
                disabled={assigning}
                onChange={(e) => setAssignDates((prev) => ({ ...prev, end: e.target.value }))}
                className="mt-1 block rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={assigning}
              className="rounded-md border border-hairline text-ink py-2 px-4 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedProfileId || assigning}
              className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            >
              {assigning ? 'Assigning…' : `Propose to ${members.length}`}
            </button>
          </div>
        </form>
      )}
    </AccessibleDialog>
  )
}
