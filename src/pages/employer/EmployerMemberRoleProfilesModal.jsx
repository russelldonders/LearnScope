import { useCallback, useEffect, useState } from 'react'
import AccessibleDialog from '../../components/AccessibleDialog'
import MutationFeedback from '../../components/MutationFeedback'
import StatusBadge from '../../components/StatusBadge'
import { formatAbsoluteDate } from '../../lib/dates'
import {
  listEmployerRoleProfiles,
  listRoleAssignmentsForMember,
  assignEmployerRoleProfile,
  disconnectEmployerRoleAssignment,
  withdrawEmployerRoleAssignment,
  setEmployerRoleAssignmentDates,
} from '../../lib/employerRoleProfiles'

const STATUS_LABELS = {
  proposed: 'Awaiting response',
  linked: 'Linked',
  declined: 'Declined',
  disconnected: 'Disconnected',
  withdrawn: 'Withdrawn',
}

// One employee's own role profiles, managed from their own roster row --
// add/remove and set an employer-side start/end date per assignment --
// rather than only being able to assign from each role profile's own Users
// tab (RoleProfileLinkedEmployeesPanel). Removing here withdraws a still-
// proposed assignment or disconnects an already-linked one; either way it
// only ever affects this employer's own assignment record, never the
// learner's linked experience entry (which stays theirs to edit or delete).
export default function EmployerMemberRoleProfilesModal({ employer, member, onClose }) {
  const [assignments, setAssignments] = useState([])
  const [allProfiles, setAllProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [pendingProfileId, setPendingProfileId] = useState('')
  const [editingDatesFor, setEditingDatesFor] = useState(null)
  const [dateDraft, setDateDraft] = useState({ start: '', end: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [assignmentsData, profilesData] = await Promise.all([
        listRoleAssignmentsForMember(member.id),
        listEmployerRoleProfiles(employer.id),
      ])
      setAssignments(assignmentsData)
      setAllProfiles(profilesData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [member.id, employer.id])

  useEffect(() => { load() }, [load])

  async function mutate(action) {
    setSaving(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Only these two statuses represent a role profile actually in effect (or
  // pending taking effect) for this person -- declined/disconnected/
  // withdrawn assignments stay in the table for history, but aren't
  // reoffered as "currently theirs" here, and don't block re-adding the
  // same role profile later.
  const activeAssignments = assignments.filter((a) => a.status === 'proposed' || a.status === 'linked')
  const assignedProfileIds = new Set(activeAssignments.map((a) => a.roleProfileId))
  const addableProfiles = allProfiles.filter((p) => !assignedProfileIds.has(p.id))

  function handleAdd(e) {
    e.preventDefault()
    if (!pendingProfileId) return
    mutate(() => assignEmployerRoleProfile(pendingProfileId, member.id))
    setPendingProfileId('')
  }

  function handleRemove(assignment) {
    mutate(() => (
      assignment.status === 'linked'
        ? disconnectEmployerRoleAssignment(assignment.id)
        : withdrawEmployerRoleAssignment(assignment.id)
    ))
  }

  function startEditingDates(assignment) {
    setEditingDatesFor(assignment.id)
    setDateDraft({ start: assignment.startDate ?? '', end: assignment.endDate ?? '' })
  }

  function saveDates(assignmentId) {
    mutate(() => setEmployerRoleAssignmentDates(assignmentId, dateDraft.start, dateDraft.end))
    setEditingDatesFor(null)
  }

  return (
    <AccessibleDialog
      labelledBy="employer-member-role-profiles-title"
      onClose={saving ? undefined : onClose}
      closeOnBackdrop={!saving}
      panelClassName="w-full max-w-lg bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="employer-member-role-profiles-title" className="font-display text-xl text-ink mb-1">Role profiles</h2>
      <p className="text-sm text-secondary mb-4">{member.email || member.user_id}</p>

      <MutationFeedback status="error" message={error} className="mb-3" />

      {loading ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : (
        <>
          {activeAssignments.length === 0 ? (
            <p className="text-sm text-secondary mb-4">No role profiles assigned yet.</p>
          ) : (
            <ul className="divide-y divide-hairline mb-4">
              {activeAssignments.map((assignment) => (
                <li key={assignment.id} className="py-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink">{assignment.roleProfileName}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge label={STATUS_LABELS[assignment.status] ?? assignment.status} tone={assignment.status === 'linked' ? 'success' : 'neutral'} />
                      <button
                        type="button"
                        onClick={() => handleRemove(assignment)}
                        disabled={saving}
                        className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {editingDatesFor === assignment.id ? (
                    <div className="flex flex-wrap items-end gap-2 mt-2">
                      <label className="text-xs text-secondary">
                        Start date
                        <input
                          type="date"
                          value={dateDraft.start}
                          onChange={(e) => setDateDraft((prev) => ({ ...prev, start: e.target.value }))}
                          className="mt-1 block rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
                        />
                      </label>
                      <label className="text-xs text-secondary">
                        End date
                        <input
                          type="date"
                          value={dateDraft.end}
                          onChange={(e) => setDateDraft((prev) => ({ ...prev, end: e.target.value }))}
                          className="mt-1 block rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => saveDates(assignment.id)}
                        disabled={saving}
                        className="rounded-md bg-moss text-paper py-1 px-2 text-xs font-medium hover:opacity-90 disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingDatesFor(null)}
                        className="text-xs font-medium text-secondary hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditingDates(assignment)}
                      className="text-xs text-secondary hover:text-ink mt-1 underline decoration-dotted"
                    >
                      {assignment.startDate || assignment.endDate
                        ? `${assignment.startDate ? formatAbsoluteDate(assignment.startDate) : 'No start date'} – ${assignment.endDate ? formatAbsoluteDate(assignment.endDate) : 'ongoing'}`
                        : 'Set start/end date'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 pt-3 border-t border-hairline">
            <div className="flex-1 min-w-[10rem]">
              <label htmlFor="employer-member-add-role-profile" className="block text-xs text-secondary mb-1">
                Add a role profile
              </label>
              <select
                id="employer-member-add-role-profile"
                value={pendingProfileId}
                disabled={saving || addableProfiles.length === 0}
                onChange={(e) => setPendingProfileId(e.target.value)}
                className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink"
              >
                <option value="">
                  {addableProfiles.length === 0 ? 'No more role profiles to add' : 'Choose a role profile…'}
                </option>
                {addableProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={saving || !pendingProfileId}
              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60"
            >
              Add
            </button>
          </form>
        </>
      )}

      <div className="pt-5">
        <button type="button" onClick={onClose} className="rounded-md border border-hairline px-4 py-2 text-sm text-ink hover:bg-paper">
          Close
        </button>
      </div>
    </AccessibleDialog>
  )
}
