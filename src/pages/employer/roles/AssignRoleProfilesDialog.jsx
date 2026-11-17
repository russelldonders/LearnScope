import { useMemo, useState } from 'react'
import AccessibleDialog from '../../../components/AccessibleDialog'
import MutationFeedback from '../../../components/MutationFeedback'

// Proposes several role profiles to several employees in one go, from the
// role profiles table's bulk actions. Like every other assign path this only
// *proposes* each role -- each employee still accepts it themselves -- and
// anyone who already has a selected role proposed or linked is skipped for
// that role rather than re-proposed. onAssign(memberIds, { startDate,
// endDate }) resolves to { proposed, skipped } (counts of role/employee
// pairs).
export default function AssignRoleProfilesDialog({ roleProfiles, members, onAssign, onClose }) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [dates, setDates] = useState({ start: '', end: '' })
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState(null)

  const assignableMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter((m) =>
      m.status === 'active' &&
      (!q || m.email?.toLowerCase().includes(q) || m.userCode?.toLowerCase().includes(q))
    )
  }, [members, search])

  function toggle(memberId) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selectedIds.size === 0) return
    setAssigning(true)
    setError(null)
    try {
      await onAssign([...selectedIds], { startDate: dates.start || null, endDate: dates.end || null })
    } catch (err) {
      setError(err.message)
      setAssigning(false)
    }
  }

  const roleNames = roleProfiles.map((p) => p.name).join(', ')

  return (
    <AccessibleDialog
      labelledBy="assign-role-profiles-title"
      onClose={assigning ? undefined : onClose}
      closeOnBackdrop={!assigning}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
      <h2 id="assign-role-profiles-title" className="font-display text-xl text-ink mb-1">
        Assign {roleProfiles.length} role profile{roleProfiles.length === 1 ? '' : 's'}
      </h2>
      <p className="text-sm text-secondary mb-1">{roleNames}</p>
      <p className="text-xs text-secondary mb-4">
        Each employee is asked to accept each role themselves — this doesn&apos;t change their profile automatically.
        Anyone who already has one of these roles keeps it as it is.
      </p>

      <MutationFeedback status="error" message={error} size="xs" className="mb-3" />

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="assign-role-profiles-search" className="block text-xs text-secondary mb-1">
            Employees
          </label>
          <input
            id="assign-role-profiles-search"
            type="text"
            value={search}
            disabled={assigning}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full rounded-md border border-hairline bg-paper px-2 py-1.5 text-sm text-ink mb-2"
          />
          <div className="border border-hairline rounded-md divide-y divide-hairline max-h-56 overflow-y-auto">
            {assignableMembers.length === 0 ? (
              <p className="text-sm text-secondary px-3 py-2">
                {search.trim() ? 'No matching active employees.' : 'No active employees yet.'}
              </p>
            ) : (
              assignableMembers.map((m) => (
                <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink hover:bg-paper cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.id)}
                    disabled={assigning}
                    onChange={() => toggle(m.id)}
                    className="rounded border-hairline accent-moss"
                  />
                  {m.email}
                  {m.userCode && <span className="text-xs text-secondary">({m.userCode})</span>}
                </label>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-secondary">
            Start date (optional)
            <input
              type="date"
              value={dates.start}
              disabled={assigning}
              onChange={(e) => setDates((prev) => ({ ...prev, start: e.target.value }))}
              className="mt-1 block rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-secondary">
            End date (optional)
            <input
              type="date"
              value={dates.end}
              disabled={assigning}
              onChange={(e) => setDates((prev) => ({ ...prev, end: e.target.value }))}
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
            disabled={assigning || selectedIds.size === 0}
            className="rounded-md bg-moss text-paper py-2 px-4 text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {assigning
              ? 'Assigning…'
              : selectedIds.size === 0
                ? 'Assign'
                : `Assign to ${selectedIds.size} employee${selectedIds.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </AccessibleDialog>
  )
}
